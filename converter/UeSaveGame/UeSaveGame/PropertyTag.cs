// Copyright 2025 Crystal Ferrai
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Modified by ItsNotCam for ue-save-preview-vscode (raw-bytes fallback, property guids/extensions, SoftClassPath).

using System.Reflection.PortableExecutable;
using UeSaveGame.PropertyTypes;
using UeSaveGame.Util;

namespace UeSaveGame
{
	public class FPropertyTag
	{
		private long mSizeOffset;

		/// <summary>
		/// Gets the name of the property
		/// </summary>
		public FString Name { get; }

		/// <summary>
		/// Gets the name of the type of the property's value
		/// </summary>
		public FPropertyTypeName Type { get; }

		public FProperty? Property { get; set; }

		internal int Size { get; private set; }

		internal int ArrayIndex { get; }

		/// <summary>
		/// Property serialization flags
		/// </summary>
		internal EPropertyTagFlags Flags { get; set; }

		/// <summary>
		/// Optional property guid stored in the tag
		/// </summary>
		public Guid? PropertyGuid { get; set; }

		/// <summary>
		/// Raw bytes of the type-specific header as read (pre-UE5.4), used when the value falls back to a RawProperty
		/// </summary>
		internal byte[] HeaderBytes { get; set; } = Array.Empty<byte>();

		/// <summary>
		/// Raw property tag extension data (UE5.4+), written back unchanged
		/// </summary>
		public byte[] ExtensionBytes { get; set; } = Array.Empty<byte>();

		/// <summary>
		/// Reads FPropertyTag extension data: an EPropertyTagExtension byte, then for OverridableInformation an
		/// EOverriddenPropertyOperation byte and a bExperimentalOverridableLogic bool (serialized as uint32).
		/// </summary>
		private static byte[] ReadExtensions(BinaryReader reader)
		{
			byte extensions = reader.ReadByte();
			const byte OverridableInformation = 0x02;
			if ((extensions & ~OverridableInformation) != 0)
			{
				throw new NotSupportedException($"Unknown property tag extension flags 0x{extensions:X2}.");
			}
			using MemoryStream data = new();
			data.WriteByte(extensions);
			if ((extensions & OverridableInformation) != 0)
			{
				data.Write(reader.ReadBytes(5));
			}
			return data.ToArray();
		}

		public bool IsNone { get; private set; }

		public static FPropertyTag NoneProperty = new(new("None"), new(new("None")), 0, 0, null, EPropertyTagFlags.None) { IsNone = true };

		internal FPropertyTag(FString name, FPropertyTypeName type, int size, int arrayIndex, FProperty? property, EPropertyTagFlags flags)
		{
			mSizeOffset = 0;

			Name = name;
			Type = type;
			Property = property;
			Size = size;
			ArrayIndex = arrayIndex;
			Flags = flags;

			IsNone = false;
		}

		/// <summary>
		/// Creates a new property tag using metadata from an existing property tag. The new
		/// tag will not contain any property unless it is later assigned one.
		/// </summary>
		/// <param name="other">The tag to clone metadata from</param>
		public FPropertyTag(FPropertyTag other)
		{
			Name = other.Name;
			Type = other.Type.Clone();
			Property = null;
			Size = 0;
			ArrayIndex = other.ArrayIndex;
			Flags = other.Flags;
			PropertyGuid = other.PropertyGuid;
			ExtensionBytes = other.ExtensionBytes;
		}

		/// <summary>
		/// Deserializes a new property tag
		/// </summary>
		/// <param name="reader">The reader to read the property from</param>
		/// <param name="packageVersion">The engine package serialization version</param>
		/// <param name="overrideName">If specified, overrides the name of the new property</param>
		/// <returns>The deserialized property</returns>
		public static FPropertyTag Deserialize(BinaryReader reader, PackageVersion packageVersion, FString? overrideName = null)
		{
			FString name = reader.ReadUnrealString() ?? throw new InvalidDataException("Error reading property name");
			if (name == "None") return NoneProperty;

			if (overrideName is not null)
			{
				name = overrideName;
			}

			FPropertyTypeName type = FPropertyTypeName.Deserialize(reader, packageVersion);

			int size = reader.ReadInt32();
			int arrayIndex = 0;
			if (packageVersion < EObjectUE5Version.PROPERTY_TAG_COMPLETE_TYPE_NAME)
			{
				arrayIndex = reader.ReadInt32();
			}

			FProperty property = FProperty.Create(name, type);
			property.ProcessTypeName(type, packageVersion);

			long headerStart = reader.BaseStream.CanSeek ? reader.BaseStream.Position : -1;
			property.DeserializeHeader(reader, packageVersion);
			byte[] headerBytes = Array.Empty<byte>();
			if (headerStart >= 0 && reader.BaseStream.Position > headerStart)
			{
				// Remember the type-specific header so the value can still fall back to a RawProperty later.
				long headerEnd = reader.BaseStream.Position;
				reader.BaseStream.Seek(headerStart, SeekOrigin.Begin);
				headerBytes = reader.ReadBytes((int)(headerEnd - headerStart));
			}

			EPropertyTagFlags flags = EPropertyTagFlags.None;
			Guid? propertyGuid = null;
			byte[] extensionBytes = Array.Empty<byte>();
			if (packageVersion >= EObjectUE5Version.PROPERTY_TAG_COMPLETE_TYPE_NAME)
			{
				flags = (EPropertyTagFlags)reader.ReadByte();
				if (flags.HasFlag(EPropertyTagFlags.HasArrayIndex))
				{
					arrayIndex = reader.ReadInt32();
				}
				if (flags.HasFlag(EPropertyTagFlags.HasPropertyGuid))
				{
					propertyGuid = new Guid(reader.ReadBytes(16));
				}
				if (flags.HasFlag(EPropertyTagFlags.HasPropertyExtensions))
				{
					extensionBytes = ReadExtensions(reader);
				}

				if (property is BoolProperty bp)
				{
					bp.Value = flags.HasFlag(EPropertyTagFlags.BoolTrue);
				}
			}
			else
			{
				// Pre-UE5.4: one HasPropertyGuid byte, followed by the guid when set. BoolProperty stores its value
				// before it instead (BoolProperty has no header, so this byte is its value).
				byte b = reader.ReadByte();
				if (property is BoolProperty bp)
				{
					bp.Value = b == 1;
				}
				else if (b != 0)
				{
					propertyGuid = new Guid(reader.ReadBytes(16));
				}
			}

			return new(name, type, size, arrayIndex, property, flags) { PropertyGuid = propertyGuid, HeaderBytes = headerBytes, ExtensionBytes = extensionBytes };
		}

		/// <summary>
		/// Serialize this property tag
		/// </summary>
		/// <param name="writer">The writer to write the proiperty to</param>
		/// <param name="engineVersion">The version of Unreal Engine to serialize this property for</param>
		public int Serialize(BinaryWriter writer, PackageVersion packageVersion)
		{
			long startPos = writer.BaseStream.Position;

			writer.WriteUnrealString(Name);
			Type.Serialize(writer, packageVersion);

			mSizeOffset = writer.BaseStream.Position;
			writer.Write(0);
			if (packageVersion < EObjectUE5Version.PROPERTY_TAG_COMPLETE_TYPE_NAME)
			{
				writer.Write(ArrayIndex);
			}

			Property?.SerializeHeader(writer, packageVersion);

			if (packageVersion >= EObjectUE5Version.PROPERTY_TAG_COMPLETE_TYPE_NAME)
			{
				if (Property is BoolProperty bp)
				{
					if (bp.Value)
					{
						Flags |= EPropertyTagFlags.BoolTrue;
					}
					else
					{
						Flags &= ~EPropertyTagFlags.BoolTrue;
					}
				}

				if (PropertyGuid.HasValue)
				{
					Flags |= EPropertyTagFlags.HasPropertyGuid;
				}
				else
				{
					Flags &= ~EPropertyTagFlags.HasPropertyGuid;
				}

				writer.Write((byte)Flags);
				if (Flags.HasFlag(EPropertyTagFlags.HasArrayIndex))
				{
					writer.Write(ArrayIndex);
				}
				if (PropertyGuid.HasValue)
				{
					writer.Write(PropertyGuid.Value.ToByteArray());
				}
				if (Flags.HasFlag(EPropertyTagFlags.HasPropertyExtensions))
				{
					writer.Write(ExtensionBytes);
				}
			}
			else
			{
				if (Property is BoolProperty bp)
				{
					writer.Write(bp.Value ? (byte)1 : (byte)0);
				}
				else if (PropertyGuid.HasValue)
				{
					writer.Write((byte)1);
					writer.Write(PropertyGuid.Value.ToByteArray());
				}
				else
				{
					writer.Write((byte)0);
				}
			}

			return (int)(writer.BaseStream.Position - startPos);
		}

		public void DeserializeProperty(BinaryReader reader, PackageVersion packageVersion)
		{
			if (Property is BoolProperty bp)
			{
				if (packageVersion < EObjectUE5Version.PROPERTY_TAG_COMPLETE_TYPE_NAME)
				{
					reader.ReadByte();
				}
				return;
			}

			if (Property is null || IsNone)
			{
				return;
			}

			if (!reader.BaseStream.CanSeek)
			{
				Property.DeserializeValue(reader, Size, packageVersion);
				return;
			}

			// Read the value; if the type is unknown, the parse throws, or it consumes a different number of bytes than
			// the tag says, rewind and keep the exact bytes instead so the save still round-trips.
			long start = reader.BaseStream.Position;
			string? failure = null;
			if (Property is RawProperty unknown)
			{
				failure = unknown.Reason;
			}
			else if (Flags.HasFlag(EPropertyTagFlags.HasBinaryOrNativeSerialize) && Property is StructProperty sp && !sp.HasKnownStructType)
			{
				failure = $"Struct type {sp.StructType?.Name ?? "?"} uses native serialization and is not implemented.";
			}
			else
			{
				try
				{
					Property.DeserializeValue(reader, Size, packageVersion);
					long consumed = reader.BaseStream.Position - start;
					if (consumed != Size)
					{
						failure = $"Parsed {consumed} bytes but the tag says {Size}.";
					}
				}
				catch (Exception ex)
				{
					failure = $"{ex.GetType().Name}: {ex.Message}";
				}
			}

			if (failure is not null)
			{
				reader.BaseStream.Seek(start, SeekOrigin.Begin);
				RawProperty raw = new(Name) { HeaderBytes = HeaderBytes, Reason = failure };
				raw.DeserializeValue(reader, Size, packageVersion);
				Property = raw;
			}
		}

		public int SerializeProperty(BinaryWriter writer, PackageVersion packageVersion)
		{
			if (Property is BoolProperty bp)
			{
				if (packageVersion < EObjectUE5Version.PROPERTY_TAG_COMPLETE_TYPE_NAME)
				{
					writer.Write((byte)0);
				}
				return 0;
			}

			int size = Property?.SerializeValue(writer, packageVersion) ?? 0;
			WriteSize(writer, size, packageVersion);
			return size;
		}

		internal void WriteSize(BinaryWriter writer, int size, PackageVersion packageVersion)
		{
			Size = size;

			long offset = writer.BaseStream.Position;
			writer.BaseStream.Seek(mSizeOffset, SeekOrigin.Begin);

			writer.Write(Size);

			writer.BaseStream.Seek(offset, SeekOrigin.Begin);
		}

		public override string ToString()
		{
			return Name;
		}
	}

	internal enum EPropertyTagFlags : byte
	{
		None = 0x00,
		HasArrayIndex = 0x01,
		HasPropertyGuid = 0x02,
		HasPropertyExtensions = 0x04,
		HasBinaryOrNativeSerialize = 0x08,
		BoolTrue = 0x10,
		SkippedSerialize = 0x20
	};
}
