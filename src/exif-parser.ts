// Basic EXIF/TIFF parser for extracting camera metadata
// This is a simplified implementation that extracts common EXIF fields

export interface ExifData {
  make?: string;
  model?: string;
  focalLength?: string;
  fNumber?: string;
  exposureTime?: string;
  iso?: number;
  dateTimeOriginal?: string;
  dateTime?: string;
  colorSpace?: string;
  hasAlpha?: boolean;
  redEye?: boolean;
  meteringMode?: string;
  exposureProgram?: string;
}

// EXIF tag IDs
const EXIF_TAGS = {
  Make: 0x010F,
  Model: 0x0110,
  DateTime: 0x0132,
  DateTimeOriginal: 0x9003,
  FocalLength: 0x920A,
  FNumber: 0x829D,
  ExposureTime: 0x829A,
  ISOSpeedRatings: 0x8827,
  ColorSpace: 0xA001,
  MeteringMode: 0x9207,
  ExposureProgram: 0x8822,
};

// Metering mode names
const METERING_MODES: { [key: number]: string } = {
  0: 'Unknown',
  1: 'Average',
  2: 'Center-weighted average',
  3: 'Spot',
  4: 'Multi-spot',
  5: 'Multi-segment',
  6: 'Partial',
  255: 'Other',
};

// Exposure program names
const EXPOSURE_PROGRAMS: { [key: number]: string } = {
  0: 'Not defined',
  1: 'Manual',
  2: 'Normal program',
  3: 'Aperture priority',
  4: 'Shutter priority',
  5: 'Creative program',
  6: 'Action program',
  7: 'Portrait mode',
  8: 'Landscape mode',
};

export function parseExif(exifSegment: Uint8Array): ExifData {
  const data: ExifData = {};
  
  if (exifSegment.length < 6) return data;
  
  // Check for EXIF header
  const header = String.fromCharCode(...exifSegment.subarray(0, 6));
  if (!header.startsWith('Exif')) return data;
  
  try {
    // TIFF header starts at offset 6
    let offset = 6;
    
    // Read byte order (II = little endian, MM = big endian)
    if (offset + 2 > exifSegment.length) return data;
    const byteOrder = String.fromCharCode(exifSegment[offset], exifSegment[offset + 1]);
    const isLittleEndian = byteOrder === 'II';
    offset += 2;
    
    // Read TIFF magic number (should be 42)
    if (offset + 2 > exifSegment.length) return data;
    const magic = readUint16(exifSegment, offset, isLittleEndian);
    if (magic !== 42) return data;
    offset += 2;
    
    // Helper to parse an IFD
    const parseIFD = (ifdOffset: number): number => {
      let currentOffset = ifdOffset;
      if (currentOffset + 2 > exifSegment.length) return currentOffset;
      
      const entryCount = readUint16(exifSegment, currentOffset, isLittleEndian);
      currentOffset += 2;
      
      let exifSubIFDOffset: number | null = null;
      
      // Read IFD entries
      for (let i = 0; i < entryCount && currentOffset + 12 <= exifSegment.length; i++) {
        const tag = readUint16(exifSegment, currentOffset, isLittleEndian);
        const type = readUint16(exifSegment, currentOffset + 2, isLittleEndian);
        const count = readUint32(exifSegment, currentOffset + 4, isLittleEndian);
        const valueOffset = readUint32(exifSegment, currentOffset + 8, isLittleEndian);
        
        // Read tag value
        let value: any = null;
        const tagSize = getTypeSize(type);
        const totalSize = count * tagSize;
        
        if (totalSize <= 4) {
          // Value is stored directly in the offset field
          value = readValue(exifSegment, currentOffset + 8, type, count, isLittleEndian, 6);
        } else {
          // Value is stored at the offset
          value = readValue(exifSegment, 6 + valueOffset, type, count, isLittleEndian, 6);
        }
        
        // Check for EXIF sub-IFD pointer (tag 0x8769)
        if (tag === 0x8769) {
          exifSubIFDOffset = 6 + valueOffset;
        }
        
        // Map tag to field (only if not already set)
        switch (tag) {
          case EXIF_TAGS.Make:
            if (!data.make) data.make = value;
            break;
          case EXIF_TAGS.Model:
            if (!data.model) data.model = value;
            break;
          case EXIF_TAGS.DateTime:
            if (!data.dateTime) data.dateTime = value;
            break;
          case EXIF_TAGS.DateTimeOriginal:
            if (!data.dateTimeOriginal) data.dateTimeOriginal = value;
            break;
          case EXIF_TAGS.ColorSpace:
            if (typeof value === 'number' && !data.colorSpace) {
              data.colorSpace = value === 1 ? 'sRGB' : value === 0xFFFF ? 'Uncalibrated' : 'RGB';
            }
            break;
        }
        
        currentOffset += 12;
      }
      
      // Read next IFD offset (for thumbnail IFD, we skip it)
      if (currentOffset + 4 <= exifSegment.length) {
        const nextIFDOffset = readUint32(exifSegment, currentOffset, isLittleEndian);
        // Note: We don't parse next IFD (thumbnail) as it's not needed
      }
      
      // Parse EXIF sub-IFD if found (contains exposure settings)
      if (exifSubIFDOffset !== null) {
        parseExifSubIFD(exifSubIFDOffset);
      }
      
      return currentOffset;
    };
    
    // Helper to parse EXIF sub-IFD (where camera settings are)
    const parseExifSubIFD = (ifdOffset: number): void => {
      if (ifdOffset + 2 > exifSegment.length) return;
      
      const entryCount = readUint16(exifSegment, ifdOffset, isLittleEndian);
      let currentOffset = ifdOffset + 2;
      
      for (let i = 0; i < entryCount && currentOffset + 12 <= exifSegment.length; i++) {
        const tag = readUint16(exifSegment, currentOffset, isLittleEndian);
        const type = readUint16(exifSegment, currentOffset + 2, isLittleEndian);
        const count = readUint32(exifSegment, currentOffset + 4, isLittleEndian);
        const valueOffset = readUint32(exifSegment, currentOffset + 8, isLittleEndian);
        
        // Read tag value
        let value: any = null;
        const tagSize = getTypeSize(type);
        const totalSize = count * tagSize;
        
        if (totalSize <= 4) {
          value = readValue(exifSegment, currentOffset + 8, type, count, isLittleEndian, 6);
        } else {
          value = readValue(exifSegment, 6 + valueOffset, type, count, isLittleEndian, 6);
        }
        
        // Map EXIF sub-IFD tags to fields
        switch (tag) {
          case EXIF_TAGS.FocalLength:
            if (typeof value === 'number' && !data.focalLength) {
              data.focalLength = `${value} mm`;
            }
            break;
          case EXIF_TAGS.FNumber:
            if (typeof value === 'number' && !data.fNumber) {
              data.fNumber = `f/${value}`;
            }
            break;
          case EXIF_TAGS.ExposureTime:
            if (typeof value === 'number' && !data.exposureTime) {
              if (value < 1) {
                data.exposureTime = `1/${Math.round(1 / value)}`;
              } else {
                data.exposureTime = `${value}`;
              }
            }
            break;
          case EXIF_TAGS.ISOSpeedRatings:
            if (typeof value === 'number' && data.iso === undefined) {
              data.iso = value;
            }
            break;
          case EXIF_TAGS.MeteringMode:
            if (typeof value === 'number' && !data.meteringMode) {
              data.meteringMode = METERING_MODES[value] || `Mode ${value}`;
            }
            break;
          case EXIF_TAGS.ExposureProgram:
            if (typeof value === 'number' && !data.exposureProgram) {
              data.exposureProgram = EXPOSURE_PROGRAMS[value] || `Program ${value}`;
            }
            break;
        }
        
        currentOffset += 12;
      }
    };
    
    // Read offset to first IFD
    if (offset + 4 > exifSegment.length) return data;
    let ifdOffset = readUint32(exifSegment, offset, isLittleEndian);
    offset = 6 + ifdOffset;
    
    // Parse main IFD (which will also parse EXIF sub-IFD)
    parseIFD(offset);
  } catch (e) {
    console.error('[EXIF Parser] Error parsing EXIF:', e);
  }
  
  return data;
}

function readUint16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  if (littleEndian) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  } else {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  if (littleEndian) {
    return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
  } else {
    return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
  }
}

function getTypeSize(type: number): number {
  switch (type) {
    case 1: return 1; // BYTE
    case 2: return 1; // ASCII
    case 3: return 2; // SHORT
    case 4: return 4; // LONG
    case 5: return 8; // RATIONAL
    case 7: return 1; // UNDEFINED
    case 9: return 4; // SLONG
    case 10: return 8; // SRATIONAL
    default: return 1;
  }
}

function readValue(bytes: Uint8Array, offset: number, type: number, count: number, littleEndian: boolean, baseOffset: number): any {
  switch (type) {
    case 1: // BYTE
      if (count === 1) return bytes[offset];
      return Array.from(bytes.subarray(offset, offset + count));
    case 2: // ASCII
      let str = '';
      for (let i = 0; i < count - 1; i++) { // -1 to exclude null terminator
        if (offset + i < bytes.length) {
          str += String.fromCharCode(bytes[offset + i]);
        }
      }
      return str;
    case 3: // SHORT
      if (count === 1) return readUint16(bytes, offset, littleEndian);
      const shorts: number[] = [];
      for (let i = 0; i < count; i++) {
        shorts.push(readUint16(bytes, offset + i * 2, littleEndian));
      }
      return shorts;
    case 4: // LONG
      if (count === 1) return readUint32(bytes, offset, littleEndian);
      const longs: number[] = [];
      for (let i = 0; i < count; i++) {
        longs.push(readUint32(bytes, offset + i * 4, littleEndian));
      }
      return longs;
    case 5: // RATIONAL
      if (count === 1) {
        const numerator = readUint32(bytes, offset, littleEndian);
        const denominator = readUint32(bytes, offset + 4, littleEndian);
        return denominator !== 0 ? numerator / denominator : 0;
      }
      // Multiple rationals - return first one for simplicity
      const num = readUint32(bytes, offset, littleEndian);
      const den = readUint32(bytes, offset + 4, littleEndian);
      return den !== 0 ? num / den : 0;
    case 10: // SRATIONAL
      if (count === 1) {
        const num = readInt32(bytes, offset, littleEndian);
        const den = readInt32(bytes, offset + 4, littleEndian);
        return den !== 0 ? num / den : 0;
      }
      const snum = readInt32(bytes, offset, littleEndian);
      const sden = readInt32(bytes, offset + 4, littleEndian);
      return sden !== 0 ? snum / sden : 0;
    default:
      return null;
  }
}

function readInt32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  const uint = readUint32(bytes, offset, littleEndian);
  // Convert to signed
  return uint > 0x7FFFFFFF ? uint - 0x100000000 : uint;
}

