// Use bundled UI (ui.html) so we can load extra assets like WASM encoders
import htmlContent from '__html__';

import { parseExif } from './exif-parser';
import { parseIptc } from './iptc-parser';

// ============================================================================
// FEATURE FLAG: AVIF Export
// ============================================================================
// AVIF export is disabled by default due to performance limitations.
// To enable: Set ENABLE_AVIF_EXPORT = true in both code.ts and ui.ts
// See AVIF_FEATURE.md for details
// ============================================================================
const ENABLE_AVIF_EXPORT = true;

console.log('[Code] Plugin starting, showing UI');
figma.showUI(htmlContent, { width: 420, height: 400 }); // Increased height for thumbnail selection

// Check for multiple fills when selection changes
figma.on('selectionchange', async () => {
  console.log('[Code] Selection changed, checking for multiple fills...');
  await checkAndSendFillInfo();
});

// Helper function to check and send fill info
async function checkAndSendFillInfo() {
  if (figma.currentPage.selection.length === 0) {
    figma.ui.postMessage({ type: 'no-selection' });
    return;
  }
  
  const node = figma.currentPage.selection[0];
  const imageFills = findAllImageFills(node);
  
  if (imageFills.length === 0) {
    figma.ui.postMessage({ type: 'no-image-fills' });
    return;
  }
  
  if (imageFills.length === 1) {
    // Single fill - proceed normally and load metadata
    const imageHash = imageFills[0].imageHash;
    figma.ui.postMessage({ type: 'single-fill', imageHash });
    // Load metadata for single image
    loadAndSendMetadata(imageHash).catch(err => {
      console.error('[Code] Error loading metadata:', err);
    });
    return;
  }
  
  // Multiple fills - get thumbnails and send to UI for selection
  console.log(`[Code] Found ${imageFills.length} image fills, generating thumbnails...`);
  figma.ui.postMessage({ type: 'status', message: 'Generating thumbnails…' });
  
  try {
    const thumbnails = await getImageThumbnails(node);
    console.log(`[Code] Generated ${thumbnails.length} thumbnails`);
    
    // Convert Uint8Array to ArrayBuffer for postMessage (Figma's postMessage handles ArrayBuffer)
    const imagesData = imageFills.map((fill, index) => {
      const thumb = thumbnails.find(t => t.hash === fill.imageHash);
      return {
        hash: fill.imageHash,
        index: index + 1,
        thumbnail: thumb ? Array.from(thumb.thumbnail) : undefined // Convert to regular array for JSON serialization
      };
    });
    
    console.log(`[Code] Sending ${imagesData.length} images to UI`);
    figma.ui.postMessage({
      type: 'multiple-fills',
      images: imagesData
    });
    
    // Load metadata for topmost image (default selection)
    if (imageFills.length > 0) {
      const topmostHash = imageFills[imageFills.length - 1].imageHash;
      loadAndSendMetadata(topmostHash).catch(err => {
        console.error('[Code] Error loading metadata:', err);
      });
    }
  } catch (err) {
    console.error('[Code] Error generating thumbnails:', err);
    figma.ui.postMessage({ 
      type: 'status', 
      message: 'Failed to generate thumbnails. Using topmost image.' 
    });
    // Fallback: send without thumbnails
    figma.ui.postMessage({
      type: 'multiple-fills',
      images: imageFills.map((fill, index) => ({
        hash: fill.imageHash,
        index: index + 1,
        thumbnail: undefined
      }))
    });
  }
}

type ImagePaintWithHash = ImagePaint & { imageHash: string };

function findAllImageFills(node: SceneNode): ImagePaintWithHash[] {
  const asAny = node as any;
  const fills: Paint[] | undefined = asAny.fills;
  if (!fills || !Array.isArray(fills)) return [];
  
  // Collect all image fills (fills are ordered from bottom to top)
  const imageFills: ImagePaintWithHash[] = [];
  for (const fill of fills) {
    if (fill.type === 'IMAGE' && (fill as ImagePaint).imageHash) {
      imageFills.push(fill as ImagePaintWithHash);
    }
  }
  
  return imageFills;
}

function findImageFill(node: SceneNode): ImagePaintWithHash | null {
  const imageFills = findAllImageFills(node);
  if (imageFills.length === 0) return null;
  
  // If multiple image fills exist, use the topmost one (last in array)
  // and warn the user
  if (imageFills.length > 1) {
    console.warn(`[Code] Multiple image fills detected (${imageFills.length}). Using topmost fill for metadata.`);
    figma.notify(`Multiple image fills found. Using topmost for metadata.`);
  }
  
  // Return the topmost image fill (last in the array, as fills are bottom-to-top)
  return imageFills[imageFills.length - 1];
}

async function getImageThumbnails(node: SceneNode): Promise<Array<{ hash: string; thumbnail: Uint8Array }>> {
  const imageFills = findAllImageFills(node);
  if (imageFills.length === 0) return [];
  
  const thumbnails: Array<{ hash: string; thumbnail: Uint8Array }> = [];
  
  // Create a temporary frame to hold thumbnail rectangles (off-screen)
  const tempFrame = figma.createFrame();
  tempFrame.name = '__temp_thumbnails__';
  tempFrame.resize(200, 200);
  tempFrame.x = -10000; // Move off-screen
  tempFrame.y = -10000;
  tempFrame.fills = []; // Transparent
  figma.currentPage.appendChild(tempFrame);
  
  try {
    for (const fill of imageFills) {
      try {
        const imageHash = fill.imageHash;
        
        // Create a temporary rectangle with just this image fill to export as thumbnail
        const tempRect = figma.createRectangle();
        tempRect.fills = [fill];
        tempRect.resize(200, 200); // Small size for thumbnail
        tempFrame.appendChild(tempRect);
        
        // Export as PNG at 1x for thumbnail
        const thumbnailBytes = await tempRect.exportAsync({
          format: 'PNG',
          constraint: { type: 'SCALE', value: 1 }
        });
        
        thumbnails.push({
          hash: imageHash,
          thumbnail: thumbnailBytes
        });
        
        // Remove rectangle from frame
        tempRect.remove();
      } catch (err) {
        console.error(`[Code] Failed to create thumbnail for image ${fill.imageHash}:`, err);
      }
    }
  } finally {
    // Clean up temporary frame
    tempFrame.remove();
  }
  
  return thumbnails;
}

async function exportSelectedWithMetadata(scale: number = 1, selectedImageHash?: string) {
  if (figma.currentPage.selection.length === 0) {
    figma.notify('Select a node with an image fill.');
    return;
  }

  const node = figma.currentPage.selection[0];
  const imageFills = findAllImageFills(node);
  
  if (imageFills.length === 0) {
    figma.notify('Selected node does not have an image fill.');
    return;
  }

  // Determine which image hash to use
  let imageHash: string;
  if (selectedImageHash) {
    // Use the user-selected image hash
    imageHash = selectedImageHash;
  } else if (imageFills.length === 1) {
    // Single image fill - use it
    imageHash = imageFills[0].imageHash;
  } else {
    // Multiple fills - use topmost (last in array)
    imageHash = imageFills[imageFills.length - 1].imageHash;
  }

  if (!imageHash) {
    figma.notify('No image hash found.');
    return;
  }

  figma.ui.postMessage({ type: 'status', message: 'Reading original image…' });

  // Best-effort: this should return the originally uploaded bytes (may include metadata)
  const originalBytes = await figma.getImageByHash(imageHash).getBytesAsync();

  figma.ui.postMessage({ type: 'status', message: `Exporting cropped view @${scale}x…` });

  // Export current visual (cropped/resized) as JPEG at specified scale
  const exportedBytes = await (node as ExportMixin).exportAsync({
    format: 'JPG',
    constraint: { type: 'SCALE', value: scale },
    jpgQuality: 1
  });

  const fileName = `${node.name || 'export'}@${scale}x.jpg`;

  figma.ui.postMessage({
    type: 'process-jpeg',
    original: originalBytes,
    rendered: exportedBytes,
    name: fileName
  });
}

async function exportSelectedForAvif(scale: number = 1, selectedImageHash?: string) {
  if (figma.currentPage.selection.length === 0) {
    figma.notify('Select a node with an image fill.');
    return;
  }
  const node = figma.currentPage.selection[0];
  const imageFills = findAllImageFills(node);
  
  if (imageFills.length === 0) {
    figma.notify('Selected node does not have an image fill.');
    return;
  }

  // Determine which image hash to use
  let imageHash: string;
  if (selectedImageHash) {
    // Use the user-selected image hash
    imageHash = selectedImageHash;
  } else if (imageFills.length === 1) {
    // Single image fill - use it
    imageHash = imageFills[0].imageHash;
  } else {
    // Multiple fills - use topmost (last in array)
    imageHash = imageFills[imageFills.length - 1].imageHash;
  }

  if (!imageHash) {
    figma.notify('No image hash found.');
    return;
  }

  figma.ui.postMessage({ 
    type: 'progress', 
    title: 'Exporting AVIF…',
    percent: 10, 
    text: 'Reading original image…' 
  });
  const originalBytes = await figma.getImageByHash(imageHash).getBytesAsync();

  figma.ui.postMessage({ 
    type: 'progress', 
    title: 'Exporting AVIF…',
    percent: 30, 
    text: `Exporting pixels @${scale}x…` 
  });
  // Export the visual as PNG to preserve alpha and get consistent pixels for encoder
  const renderedPng = await (node as ExportMixin).exportAsync({ 
    format: 'PNG',
    constraint: { type: 'SCALE', value: scale }
  });
  const fileName = `${node.name || 'export'}@${scale}x.avif`;

  figma.ui.postMessage({
    type: 'process-avif',
    original: originalBytes,
    renderedPng,
    name: fileName
  });
}

// Load and send metadata for a specific image hash
async function loadAndSendMetadata(imageHash: string) {
  try {
    const image = figma.getImageByHash(imageHash);
    if (!image) {
      figma.ui.postMessage({ type: 'metadata', metadata: null });
      return;
    }
    
    const size = await image.getSizeAsync();
    const originalBytes = await image.getBytesAsync();
    
    // Parse metadata from JPEG bytes
    const metadata = parseImageMetadata(originalBytes, size);
    
    figma.ui.postMessage({
      type: 'metadata',
      metadata: metadata,
      imageHash: imageHash
    });
  } catch (err) {
    console.error('[Code] Error loading metadata:', err);
    figma.ui.postMessage({ type: 'metadata', metadata: null });
  }
}

// Parse metadata from JPEG bytes
function parseImageMetadata(bytes: Uint8Array, size: { width: number; height: number }): any {
  const metadata: any = {
    dimensions: {
      width: size.width,
      height: size.height
    },
    exif: null,
    xmp: null,
    iptc: null,
    icc: null,
    hasMetadata: false
  };
  
  // Check if it's a JPEG
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return metadata;
  }
  
  // Extract EXIF and XMP (both use APP1/0xe1, need to check all segments)
  const app1Segments = extractAllAppSegments(bytes, 0xe1);
  for (const segment of app1Segments) {
    if (segment.length < 6) continue;
    
    // Check if it's EXIF
    const header = String.fromCharCode(...segment.subarray(0, Math.min(6, segment.length)));
    if (header.startsWith('Exif')) {
      if (!metadata.exif) {
        metadata.exif = parseExifBasic(segment);
        if (metadata.exif && (metadata.exif.make || metadata.exif.model || metadata.exif.focalLength || metadata.exif.dateTimeOriginal)) {
          metadata.hasMetadata = true;
        }
      }
    } else {
      // Check if it's XMP - scan more of the segment for XMP markers
      // XMP can be large, so check first 500 bytes and also look for XML declaration
      const scanLength = Math.min(500, segment.length);
      const segmentStr = String.fromCharCode(...segment.subarray(0, scanLength));
      const isXmp = segmentStr.includes('http://ns.adobe.com/xap/1.0/') || 
                    segmentStr.includes('<?xpacket') ||
                    segmentStr.includes('x:xmpmeta') ||
                    (segmentStr.includes('<?xml') && segmentStr.includes('xmp'));
      
      if (isXmp) {
        if (!metadata.xmp) {
          console.log('[Code] Found XMP segment, length:', segment.length);
          metadata.xmp = parseXmpBasic(segment);
          console.log('[Code] XMP parsed data:', {
            title: metadata.xmp?.title,
            description: metadata.xmp?.description,
            headline: metadata.xmp?.headline,
            credit: metadata.xmp?.credit,
            keywords: metadata.xmp?.keywords
          });
          if (metadata.xmp && (metadata.xmp.title || metadata.xmp.description || metadata.xmp.keywords || metadata.xmp.headline || metadata.xmp.credit)) {
            metadata.hasMetadata = true;
          }
        }
      }
    }
  }
  
  // Extract IPTC (APP13)
  const iptcSegment = extractAppSegment(bytes, 0xed, false);
  if (iptcSegment) {
    console.log('[Code] Found IPTC segment, length:', iptcSegment.length);
    metadata.iptc = parseIptcBasic(iptcSegment);
    if (metadata.iptc && (metadata.iptc.headline || metadata.iptc.credit || metadata.iptc.caption || metadata.iptc.keywords)) {
      metadata.hasMetadata = true;
    }
  } else {
    console.log('[Code] No IPTC segment found');
  }
  
  // Extract ICC (APP2)
  const iccSegment = extractAppSegment(bytes, 0xe2, false);
  if (iccSegment) {
    metadata.icc = parseIccBasic(iccSegment);
    if (metadata.icc && metadata.icc.present) {
      metadata.hasMetadata = true;
    }
  }
  
  console.log('[Code] Parsed metadata:', {
    hasExif: !!metadata.exif,
    hasXmp: !!metadata.xmp,
    hasIptc: !!metadata.iptc,
    hasIcc: !!metadata.icc,
    exifFields: metadata.exif ? Object.keys(metadata.exif).filter(k => k !== 'present') : [],
    xmpFields: metadata.xmp ? Object.keys(metadata.xmp).filter(k => k !== 'present') : [],
    iptcFields: metadata.iptc ? Object.keys(metadata.iptc).filter(k => k !== 'present') : []
  });
  
  return metadata;
}

// Extract all APP segments with given marker
function extractAllAppSegments(bytes: Uint8Array, marker: number): Uint8Array[] {
  const segments: Uint8Array[] = [];
  
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return segments;
  
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const m = bytes[i + 1]; i += 2;
    if (m === 0xda || m === 0xd9) break; // SOS or EOI
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue; // Standalone markers
    if (i + 2 > bytes.length) break;
    const len = (bytes[i] << 8) | bytes[i + 1];
    const start = i + 2;
    const end = i + len;
    if (end > bytes.length) break; // Invalid segment
    if (m === marker) {
      segments.push(bytes.subarray(start, end));
    }
    i = end;
  }
  
  return segments;
}

// Extract APP segment (single, for backward compatibility)
function extractAppSegment(bytes: Uint8Array, marker: number, xmp = false): Uint8Array | undefined {
  const segments = extractAllAppSegments(bytes, marker);
  if (segments.length === 0) return undefined;
  
  if (xmp) {
    // For XMP, find the one with XMP header
    for (const segment of segments) {
      if (segment.length >= 29) {
        const header = String.fromCharCode(...segment.subarray(0, Math.min(100, segment.length)));
        if (header.includes('http://ns.adobe.com/xap/1.0/') || 
            header.includes('<?xpacket') ||
            header.includes('x:xmpmeta')) {
          return segment;
        }
      }
    }
    return undefined;
  }
  
  return segments[0];
}

// Basic EXIF parser - extract common fields
function parseExifBasic(exifSegment: Uint8Array): any {
  const info: any = { present: true };
  
  if (exifSegment.length < 6) return info;
  
  const header = String.fromCharCode(...exifSegment.subarray(0, 6));
  if (!header.startsWith('Exif')) return info;
  
  try {
    // Use the EXIF parser to extract fields
    const exifData = parseExif(exifSegment);
    
    // Copy extracted fields
    if (exifData.make) info.make = exifData.make;
    if (exifData.model) info.model = exifData.model;
    if (exifData.focalLength) info.focalLength = exifData.focalLength;
    if (exifData.fNumber) info.fNumber = exifData.fNumber;
    if (exifData.exposureTime) info.exposureTime = exifData.exposureTime;
    if (exifData.iso !== undefined) info.iso = exifData.iso;
    if (exifData.dateTimeOriginal) info.dateTimeOriginal = exifData.dateTimeOriginal;
    if (exifData.dateTime) info.dateTime = exifData.dateTime;
    if (exifData.colorSpace) info.colorSpace = exifData.colorSpace;
    if (exifData.meteringMode) info.meteringMode = exifData.meteringMode;
    if (exifData.exposureProgram) info.exposureProgram = exifData.exposureProgram;
    
  } catch (e) {
    console.error('[Code] Error parsing EXIF:', e);
  }
  
  return info;
}

// Basic XMP parser - extract more fields
function parseXmpBasic(xmpSegment: Uint8Array): any {
  const info: any = { present: true };
  
  try {
    let xmlStart = 0;
    for (let i = 0; i < xmpSegment.length - 4; i++) {
      if (xmpSegment[i] === 0x3c && xmpSegment[i + 1] === 0x3f && 
          xmpSegment[i + 2] === 0x78 && xmpSegment[i + 3] === 0x6d) {
        xmlStart = i;
        break;
      }
    }
    
    if (xmlStart > 0) {
      let xmlEnd = xmpSegment.length;
      for (let i = xmlStart; i < xmpSegment.length; i++) {
        if (xmpSegment[i] === 0) {
          xmlEnd = i;
          break;
        }
      }
      
      const xmlBytes = xmpSegment.subarray(xmlStart, xmlEnd);
      // Decode UTF-8 - use TextDecoder if available, otherwise manual decode
      let xmlText: string;
      if (typeof TextDecoder !== 'undefined') {
        xmlText = new TextDecoder('utf-8', { fatal: false }).decode(xmlBytes);
      } else {
        // Manual UTF-8 decoding fallback
        xmlText = String.fromCharCode.apply(null, Array.from(xmlBytes));
      }
      
      // Debug: log a sample of the XML to see what we're working with
      console.log('[Code] XMP XML sample (first 500 chars):', xmlText.substring(0, 500));
      
      // Helper to extract text content, handling both simple and RDF formats
      const extractText = (pattern: RegExp, altPattern?: RegExp): string | null => {
        let match = xmlText.match(pattern);
        if (!match && altPattern) {
          match = xmlText.match(altPattern);
        }
        if (match && match[1]) {
          const text = match[1].trim()
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
          return text;
        }
        return null;
      };
      
      // Extract headline from XMP (photoshop:Headline or Iptc4xmpCore:Headline)
      // Try multiple formats: simple element, RDF bag, RDF alt
      // Also try without namespace prefix
      info.headline = extractText(/<photoshop:Headline[^>]*>(.*?)<\/photoshop:Headline>/is) ||
                    extractText(/<Iptc4xmpCore:Headline[^>]*>(.*?)<\/Iptc4xmpCore:Headline>/is) ||
                    extractText(/<Headline[^>]*>(.*?)<\/Headline>/is) ||
                    extractText(/<(?:photoshop|Iptc4xmpCore):Headline[^>]*>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is) ||
                    extractText(/<(?:photoshop|Iptc4xmpCore):Headline[^>]*>.*?<rdf:Alt>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is) ||
                    extractText(/<Headline[^>]*>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is);
      
      // Extract credit from XMP (photoshop:Credit)
      info.credit = extractText(/<photoshop:Credit[^>]*>(.*?)<\/photoshop:Credit>/is) ||
                   extractText(/<Credit[^>]*>(.*?)<\/Credit>/is) ||
                   extractText(/<photoshop:Credit[^>]*>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is) ||
                   extractText(/<photoshop:Credit[^>]*>.*?<rdf:Alt>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is);
      
      // Extract title (dc:title)
      info.title = extractText(/<dc:title[^>]*>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is) ||
                  extractText(/<title[^>]*>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is) ||
                  extractText(/<dc:title[^>]*>(.*?)<\/dc:title>/is) ||
                  extractText(/<title[^>]*>(.*?)<\/title>/is) ||
                  extractText(/<dc:title[^>]*>.*?<rdf:Alt>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is);
      
      // Extract description (dc:description)
      info.description = extractText(/<dc:description[^>]*>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is) ||
                        extractText(/<description[^>]*>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is) ||
                        extractText(/<dc:description[^>]*>(.*?)<\/dc:description>/is) ||
                        extractText(/<description[^>]*>(.*?)<\/description>/is) ||
                        extractText(/<dc:description[^>]*>.*?<rdf:Alt>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is);
      
      // Extract creator (dc:creator)
      info.creator = extractText(/<dc:creator[^>]*>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/is) ||
                   extractText(/<dc:creator[^>]*>(.*?)<\/dc:creator>/is);
      
      // Extract keywords (dc:subject) - can be multiple
      const keywordsMatch = xmlText.match(/<dc:subject[^>]*>.*?<rdf:Bag>.*?<\/rdf:Bag>/is) ||
                           xmlText.match(/<dc:subject[^>]*>.*?<rdf:Seq>.*?<\/rdf:Seq>/is);
      if (keywordsMatch) {
        const keywordsArray: string[] = [];
        const liMatches = keywordsMatch[0].matchAll(/<rdf:li[^>]*>(.*?)<\/rdf:li>/gi);
        for (const match of liMatches) {
          if (match[1]) {
            const keyword = match[1].trim().replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
            if (keyword) keywordsArray.push(keyword);
          }
        }
        if (keywordsArray.length > 0) {
          info.keywords = keywordsArray;
        }
      } else {
        // Fallback: try simple format
        const simpleKeywordsMatch = xmlText.match(/<dc:subject[^>]*>.*?<rdf:li[^>]*>(.*?)<\/rdf:li>/gis);
        if (simpleKeywordsMatch) {
          info.keywords = Array.from(simpleKeywordsMatch, (m: string) => {
            const liMatch = m.match(/<rdf:li[^>]*>(.*?)<\/rdf:li>/i);
            return liMatch ? liMatch[1].trim().replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') : null;
          }).filter((k: string | null): k is string => !!k);
        }
      }
    }
  } catch (e) {
    console.error('[Code] Error parsing XMP:', e);
  }
  
  return info;
}

// Basic IPTC parser
function parseIptcBasic(iptcSegment: Uint8Array): any {
  const info: any = { present: true };
  
  try {
    // Use the IPTC parser to extract fields
    const iptcData = parseIptc(iptcSegment);
    
    console.log('[Code] IPTC parsed data:', {
      headline: iptcData.headline,
      credit: iptcData.credit,
      caption: iptcData.caption,
      keywords: iptcData.keywords,
      city: iptcData.city,
      stateProvince: iptcData.stateProvince,
      country: iptcData.country
    });
    
    // Copy extracted fields
    if (iptcData.headline) info.headline = iptcData.headline;
    if (iptcData.credit) info.credit = iptcData.credit;
    if (iptcData.caption) info.caption = iptcData.caption;
    if (iptcData.keywords && iptcData.keywords.length > 0) info.keywords = iptcData.keywords;
    if (iptcData.instructions) info.instructions = iptcData.instructions;
    if (iptcData.byline) info.byline = iptcData.byline;
    if (iptcData.contact) info.contact = iptcData.contact;
    if (iptcData.subLocation) info.subLocation = iptcData.subLocation;
    if (iptcData.dateCreated) info.dateCreated = iptcData.dateCreated;
    if (iptcData.timeCreated) info.timeCreated = iptcData.timeCreated;
    if (iptcData.city) info.city = iptcData.city;
    if (iptcData.stateProvince) info.stateProvince = iptcData.stateProvince;
    if (iptcData.country) info.country = iptcData.country;
    
  } catch (e) {
    console.error('[Code] Error parsing IPTC:', e);
  }
  
  return info;
}

// Basic ICC parser
function parseIccBasic(iccSegment: Uint8Array): any {
  const info: any = { present: true };
  
  try {
    if (iccSegment.length >= 4) {
      const profileSize = (iccSegment[0] << 24) | (iccSegment[1] << 16) | 
                         (iccSegment[2] << 8) | iccSegment[3];
      info.size = profileSize;
      
      // Try to extract profile description
      // ICC profile description is at offset 12 (after size, CMM type, version, device class, data color space, PCS)
      // It's a 32-byte tag signature + 12-byte tag offset table, then description tag
      // This is simplified - just try to find common profile names
      if (iccSegment.length > 100) {
        const segmentStr = new TextDecoder('latin1', { fatal: false }).decode(iccSegment);
        
        // Look for common profile names
        const commonProfiles = [
          'sRGB IEC61966-2.1',
          'Adobe RGB',
          'Display P3',
          'Rec. 2020',
          'ProPhoto RGB'
        ];
        
        for (const profile of commonProfiles) {
          if (segmentStr.includes(profile)) {
            info.description = profile;
            break;
          }
        }
        
        // If not found, try to extract from description tag (simplified)
        if (!info.description) {
          // Look for "desc" tag (0x64657363) and extract text
          const descIndex = segmentStr.indexOf('desc');
          if (descIndex > 0 && descIndex < segmentStr.length - 20) {
            // Description text starts after tag header
            // This is very simplified - proper parsing would read the tag structure
            const descStart = descIndex + 12; // Skip tag signature and offset
            const descEnd = Math.min(descStart + 32, segmentStr.length);
            const desc = segmentStr.substring(descStart, descEnd).replace(/\0/g, '').trim();
            if (desc.length > 0) {
              info.description = desc;
            }
          }
        }
      }
    }
  } catch (e) {
    // Ignore parsing errors
  }
  
  return info;
}

figma.ui.onmessage = async (msg) => {
  console.log('[Code] Received message:', msg);
  
  if (msg?.type === 'check-multiple-fills' || msg?.type === 'check-selection') {
    // Check if selected node has multiple image fills and send thumbnails
    await checkAndSendFillInfo();
  } else if (msg?.type === 'load-metadata') {
    // Load metadata for a specific image hash
    await loadAndSendMetadata(msg.imageHash);
  } else if (msg?.type === 'export') {
    const scale = msg.scale || 1;
    const selectedImageHash = msg.selectedImageHash;
    console.log('[Code] Starting JPEG export @' + scale + 'x', selectedImageHash ? `(using selected image)` : '');
    exportSelectedWithMetadata(scale, selectedImageHash).catch((err) => {
      figma.notify('Export failed. See console.');
      console.error('[Code] Export error:', err);
    });
  } else if (msg?.type === 'export-avif') {
    if (!ENABLE_AVIF_EXPORT) {
      figma.notify('AVIF export is disabled. See AVIF_FEATURE.md to enable.');
      return;
    }
    const scale = msg.scale || 1;
    const selectedImageHash = msg.selectedImageHash;
    console.log('[Code] Starting AVIF export @' + scale + 'x', selectedImageHash ? `(using selected image)` : '');
    exportSelectedForAvif(scale, selectedImageHash).catch((err) => {
      figma.notify('AVIF export failed. See console.');
      console.error('[Code] AVIF export error:', err);
    });
  } else if (msg?.type === 'close') {
    console.log('[Code] Closing plugin');
    figma.closePlugin();
  } else if (msg?.type === 'notify') {
    figma.notify(msg.message || '');
  } else {
    console.warn('[Code] Unknown message type:', msg?.type);
  }
};


