// Basic IPTC parser for extracting metadata
// IPTC data is embedded in JPEG APP13 segments

export interface IptcData {
  headline?: string;
  credit?: string;
  caption?: string;
  keywords?: string[];
  city?: string;
  stateProvince?: string;
  country?: string;
  instructions?: string; // Special Instructions (record 40)
  byline?: string; // By-line/Photographer (record 80)
  contact?: string; // Contact (record 116)
  subLocation?: string; // Sub-location (record 92)
  dateCreated?: string; // Date Created (record 55)
  timeCreated?: string; // Time Created (record 60)
}

// Helper to decode UTF-8 bytes to string (works in Figma plugin environment)
function decodeUtf8(bytes: Uint8Array): string {
  // Try TextDecoder first (available in browser/UI thread)
  if (typeof TextDecoder !== 'undefined') {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (e) {
      // Fall through to manual decoding
    }
  }
  
  // Manual UTF-8 decoding fallback
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte < 0x80) {
      // ASCII
      result += String.fromCharCode(byte);
      i++;
    } else if ((byte & 0xe0) === 0xc0) {
      // 2-byte sequence
      if (i + 1 < bytes.length) {
        const byte2 = bytes[i + 1];
        const codePoint = ((byte & 0x1f) << 6) | (byte2 & 0x3f);
        result += String.fromCharCode(codePoint);
        i += 2;
      } else {
        i++;
      }
    } else if ((byte & 0xf0) === 0xe0) {
      // 3-byte sequence
      if (i + 2 < bytes.length) {
        const byte2 = bytes[i + 1];
        const byte3 = bytes[i + 2];
        const codePoint = ((byte & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f);
        result += String.fromCharCode(codePoint);
        i += 3;
      } else {
        i++;
      }
    } else {
      // Invalid or 4-byte (we'll skip 4-byte sequences for simplicity)
      i++;
    }
  }
  return result;
}

// IPTC IIM structure: Dataset 2 (Application) contains various record numbers
// Format: 0x1C [dataset] [record] [size_high] [size_low] [data...]
// Dataset 2 = Application dataset
// Record numbers in Dataset 2:
const IPTC_RECORDS = {
  ObjectName: 5,      // Record 5: Object Name
  Instructions: 40,   // Record 40: Special Instructions
  Keywords: 25,       // Record 25: Keywords
  DateCreated: 55,    // Record 55: Date Created (YYYYMMDD)
  TimeCreated: 60,    // Record 60: Time Created (HHMMSS±HHMM)
  Byline: 80,         // Record 80: By-line (Photographer/Creator)
  SubLocation: 92,    // Record 92: Sub-location
  Headline: 105,      // Record 105: Headline
  Credit: 110,        // Record 110: Credit
  Contact: 116,       // Record 116: Contact
  Caption: 120,       // Record 120: Caption/Description
  City: 90,           // Record 90: City
  ProvinceState: 95,  // Record 95: Province/State
  Country: 101,       // Record 101: Country
};

const IPTC_DATASET_APPLICATION = 2; // Application dataset

export function parseIptc(iptcSegment: Uint8Array): IptcData {
  const data: IptcData = {};
  
  if (iptcSegment.length < 14) {
    console.log('[IPTC Parser] Segment too short:', iptcSegment.length);
    return data;
  }
  
  try {
    let searchStart = 0;
    
    // Skip Photoshop header if present
    if (iptcSegment.length >= 14) {
      const header = String.fromCharCode(...iptcSegment.subarray(0, 14));
      if (header.startsWith('Photoshop 3.0')) {
        searchStart = 14;
        console.log('[IPTC Parser] Found Photoshop header, starting search at offset', searchStart);
      }
    }
    
    // First, try to find IPTC data in 8BIM resource blocks (most common)
    // IPTC is in resource ID 0x0404
    for (let i = searchStart; i < iptcSegment.length - 8; i++) {
      // Look for 8BIM marker
      if (iptcSegment[i] === 0x38 && iptcSegment[i + 1] === 0x42 && 
          iptcSegment[i + 2] === 0x49 && iptcSegment[i + 3] === 0x4D) { // "8BIM"
        
        // Check resource ID (should be 0x0404 for IPTC)
        if (i + 6 <= iptcSegment.length) {
          const resourceID = (iptcSegment[i + 4] << 8) | iptcSegment[i + 5];
          
          if (resourceID === 0x0404) {
            console.log('[IPTC Parser] Found 8BIM resource block with IPTC ID at offset', i);
            // Found IPTC resource block
            let dataOffset = i + 6;
            
            // Skip Pascal string (name) - aligned to even
            if (dataOffset < iptcSegment.length) {
              const nameLen = iptcSegment[dataOffset];
              dataOffset += 1;
              if (nameLen > 0) {
                dataOffset += nameLen;
                if (nameLen % 2 === 0) dataOffset++; // Align to even
              } else {
                dataOffset++; // Empty name still needs padding
              }
            }
            
            // Read data size (4 bytes, big-endian)
            if (dataOffset + 4 <= iptcSegment.length) {
              const dataSize = (iptcSegment[dataOffset] << 24) | 
                              (iptcSegment[dataOffset + 1] << 16) |
                              (iptcSegment[dataOffset + 2] << 8) |
                              iptcSegment[dataOffset + 3];
              dataOffset += 4;
              
              console.log('[IPTC Parser] IPTC data size:', dataSize, 'at offset', dataOffset);
              
              // Parse IPTC data within this resource block
              const iptcDataStart = dataOffset;
              const iptcDataEnd = dataOffset + dataSize;
              
              if (iptcDataEnd <= iptcSegment.length) {
                const iptcDataBlock = iptcSegment.subarray(iptcDataStart, iptcDataEnd);
                console.log('[IPTC Parser] IPTC data block first 50 bytes:', Array.from(iptcDataBlock.subarray(0, Math.min(50, iptcDataBlock.length))).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
                console.log('[IPTC Parser] Looking for 0x1C markers in data block...');
                // Check if there are any 0x1C markers
                let markerCount = 0;
                for (let j = 0; j < iptcDataBlock.length; j++) {
                  if (iptcDataBlock[j] === 0x1C) markerCount++;
                }
                console.log('[IPTC Parser] Found', markerCount, '0x1C markers in data block');
                
                parseIptcDataBlock(iptcDataBlock, data);
                console.log('[IPTC Parser] After parsing 8BIM block:', {
                  headline: data.headline,
                  credit: data.credit,
                  caption: data.caption,
                  keywords: data.keywords?.length || 0
                });
                // Continue parsing - don't return early, there might be more data
              }
            }
          }
        }
      }
    }
    
    // Fallback: Look for direct IPTC data (record marker 0x1C)
    let offset = searchStart;
    while (offset < iptcSegment.length - 5) {
      // IPTC record marker is 0x1C
      if (iptcSegment[offset] === 0x1C) {
        const dataset = iptcSegment[offset + 1];
        const recordNumber = iptcSegment[offset + 2]; // Record number, not record type
        
        // Only process Application dataset (dataset 2)
        if (dataset === IPTC_DATASET_APPLICATION) {
          const dataSize = (iptcSegment[offset + 3] << 8) | iptcSegment[offset + 4];
          const dataStart = offset + 5;
          
          if (dataSize > 0 && dataSize < 65536 && dataStart + dataSize <= iptcSegment.length) {
            const value = decodeUtf8(iptcSegment.subarray(dataStart, dataStart + dataSize))
              .replace(/\0/g, '')
              .trim();
            
            if (value) {
              switch (recordNumber) {
                case IPTC_RECORDS.Headline:
                  // Headline always takes precedence - don't check if already set
                  data.headline = value;
                  break;
                case IPTC_RECORDS.ObjectName:
                  // Object Name is different from Headline - only use as fallback (never overwrite if headline exists)
                  if (!data.headline) {
                    data.headline = value;
                  }
                  break;
                case IPTC_RECORDS.Instructions:
                  if (!data.instructions) data.instructions = value;
                  break;
                case IPTC_RECORDS.DateCreated:
                  if (!data.dateCreated) data.dateCreated = value;
                  break;
                case IPTC_RECORDS.TimeCreated:
                  if (!data.timeCreated) data.timeCreated = value;
                  break;
                case IPTC_RECORDS.Byline:
                  if (!data.byline) data.byline = value;
                  break;
                case IPTC_RECORDS.Contact:
                  if (!data.contact) data.contact = value;
                  break;
                case IPTC_RECORDS.SubLocation:
                  if (!data.subLocation) data.subLocation = value;
                  break;
                case IPTC_RECORDS.Credit:
                  if (!data.credit) data.credit = value;
                  break;
                case IPTC_RECORDS.Caption:
                  if (!data.caption) data.caption = value;
                  break;
                case IPTC_RECORDS.Keywords:
                  if (!data.keywords) data.keywords = [];
                  if (!data.keywords.includes(value)) {
                    data.keywords.push(value);
                  }
                  break;
                case IPTC_RECORDS.City:
                  if (!data.city) data.city = value;
                  break;
                case IPTC_RECORDS.ProvinceState:
                  if (!data.stateProvince) data.stateProvince = value;
                  break;
                case IPTC_RECORDS.Country:
                  if (!data.country) data.country = value;
                  break;
              }
            }
          }
          
          offset = dataStart + dataSize;
        } else {
          offset++;
        }
      } else {
        offset++;
      }
    }
  } catch (e) {
    console.error('[IPTC Parser] Error parsing IPTC:', e);
  }
  
  return data;
}

// Helper function to parse IPTC data block
function parseIptcDataBlock(iptcData: Uint8Array, data: IptcData): void {
  let offset = 0;
  let recordCount = 0;
  
  while (offset < iptcData.length - 5) {
    if (iptcData[offset] === 0x1C) {
      const dataset = iptcData[offset + 1];
      const recordNumber = iptcData[offset + 2]; // This is the record number, not record type
      
      // Only process Application dataset (dataset 2)
      if (dataset === IPTC_DATASET_APPLICATION) {
        if (offset + 5 > iptcData.length) break;
        
        const dataSize = (iptcData[offset + 3] << 8) | iptcData[offset + 4];
        const dataStart = offset + 5;
        
        // Validate data size is reasonable
        if (dataSize > 0 && dataSize < 65536 && dataStart + dataSize <= iptcData.length) {
          const valueBytes = iptcData.subarray(dataStart, dataStart + dataSize);
          const value = decodeUtf8(valueBytes)
            .replace(/\0/g, '')
            .trim();
          
          recordCount++;
          const tagName = recordNumber === IPTC_RECORDS.Headline ? 'Headline' :
                         recordNumber === IPTC_RECORDS.Caption ? 'Caption' :
                         recordNumber === IPTC_RECORDS.Credit ? 'Credit' :
                         recordNumber === IPTC_RECORDS.Keywords ? 'Keywords' :
                         recordNumber === IPTC_RECORDS.ObjectName ? 'ObjectName' :
                         recordNumber === IPTC_RECORDS.Instructions ? 'Instructions' :
                         recordNumber === IPTC_RECORDS.Byline ? 'Byline' :
                         recordNumber === IPTC_RECORDS.Contact ? 'Contact' :
                         recordNumber === IPTC_RECORDS.SubLocation ? 'SubLocation' :
                         recordNumber === IPTC_RECORDS.DateCreated ? 'DateCreated' :
                         recordNumber === IPTC_RECORDS.TimeCreated ? 'TimeCreated' :
                         recordNumber === IPTC_RECORDS.City ? 'City' :
                         recordNumber === IPTC_RECORDS.ProvinceState ? 'ProvinceState' :
                         recordNumber === IPTC_RECORDS.Country ? 'Country' :
                         `Record${recordNumber}`;
          
          if (value) {
            console.log(`[IPTC Parser] Found ${tagName} (dataset ${dataset}, record ${recordNumber}, size ${dataSize}):`, value.substring(0, 50) + (value.length > 50 ? '...' : ''));
            
            switch (recordNumber) {
              case IPTC_RECORDS.Headline:
                // Headline always takes precedence - don't check if already set
                data.headline = value;
                break;
              case IPTC_RECORDS.ObjectName:
                // Object Name is different from Headline - only use as fallback (never overwrite if headline exists)
                if (!data.headline) {
                  data.headline = value;
                }
                break;
              case IPTC_RECORDS.Instructions:
                if (!data.instructions) data.instructions = value;
                break;
              case IPTC_RECORDS.DateCreated:
                if (!data.dateCreated) data.dateCreated = value;
                break;
              case IPTC_RECORDS.TimeCreated:
                if (!data.timeCreated) data.timeCreated = value;
                break;
              case IPTC_RECORDS.Byline:
                if (!data.byline) data.byline = value;
                break;
              case IPTC_RECORDS.Contact:
                if (!data.contact) data.contact = value;
                break;
              case IPTC_RECORDS.SubLocation:
                if (!data.subLocation) data.subLocation = value;
                break;
              case IPTC_RECORDS.Credit:
                if (!data.credit) data.credit = value;
                break;
              case IPTC_RECORDS.Caption:
                if (!data.caption) data.caption = value;
                break;
              case IPTC_RECORDS.Keywords:
                if (!data.keywords) data.keywords = [];
                if (!data.keywords.includes(value)) {
                  data.keywords.push(value);
                }
                break;
              case IPTC_RECORDS.City:
                if (!data.city) data.city = value;
                break;
              case IPTC_RECORDS.ProvinceState:
                if (!data.stateProvince) data.stateProvince = value;
                break;
              case IPTC_RECORDS.Country:
                if (!data.country) data.country = value;
                break;
            }
          } else {
            console.log(`[IPTC Parser] Found ${tagName} (record ${recordNumber}) but value is empty`);
          }
          
          offset = dataStart + dataSize;
        } else {
          console.log(`[IPTC Parser] Invalid data size ${dataSize} at offset ${offset}, skipping`);
          offset++;
        }
      } else {
        // Not Application dataset, skip it
        offset++;
      }
    } else {
      offset++;
    }
  }
  
  console.log(`[IPTC Parser] Parsed ${recordCount} IPTC records`);
}

