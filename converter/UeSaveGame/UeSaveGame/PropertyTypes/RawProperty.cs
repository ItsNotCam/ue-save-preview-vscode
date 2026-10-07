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
// Modified by ItsNotCam: added for lossless fallback of unknown or unparseable property values.

namespace UeSaveGame.PropertyTypes
{
	/// <summary>
	/// Fallback for a property whose type is unknown or whose value could not be parsed. Keeps the exact bytes of the
	/// value (and of the pre-UE5.4 type-specific header, if any) so the save round-trips unchanged.
	/// </summary>
	public class RawProperty : FProperty<byte[]>
	{
		/// <summary>
		/// Bytes of the type-specific tag header (pre-UE5.4 tags only, e.g. a struct's type name and guid)
		/// </summary>
		public byte[] HeaderBytes { get; set; }

		/// <summary>
		/// Why the value is stored raw, for display only
		/// </summary>
		public string? Reason { get; set; }

		public RawProperty(FString name)
			: base(name)
		{
			HeaderBytes = Array.Empty<byte>();
			Value = Array.Empty<byte>();
		}

		protected internal override void DeserializeHeader(BinaryReader reader, PackageVersion packageVersion)
		{
			// Header bytes are captured by FPropertyTag, which knows where the header ends.
		}

		protected internal override void SerializeHeader(BinaryWriter writer, PackageVersion packageVersion)
		{
			writer.Write(HeaderBytes);
		}

		protected internal override void DeserializeValue(BinaryReader reader, int size, PackageVersion packageVersion)
		{
			if (size < 0 || reader.BaseStream.CanSeek && size > reader.BaseStream.Length - reader.BaseStream.Position)
			{
				throw new InvalidDataException($"Property size {size} is outside the file.");
			}
			Value = reader.ReadBytes(size);
			if (Value.Length != size)
			{
				throw new EndOfStreamException($"Expected {size} bytes of raw property data, got {Value.Length}.");
			}
		}

		protected internal override int SerializeValue(BinaryWriter writer, PackageVersion packageVersion)
		{
			writer.Write(Value!);
			return Value!.Length;
		}

		public override string? ToString()
		{
			return $"[raw] {Value?.Length ?? 0} bytes";
		}
	}
}
