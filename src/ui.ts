// UI logic: button to export, JPEG metadata merge, and download

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setStatus(text: string) {
  byId('status').textContent = text;
}

function getSelectedScale(): number {
  const scaleSelect = document.getElementById('scale-select') as HTMLSelectElement;
  return scaleSelect ? parseInt(scaleSelect.value, 10) : 2;
}

// Store selected image hash for metadata source
let selectedImageHash: string | null = null;

function showThumbnailSelection(images: Array<{ hash: string; index: number; thumbnail?: number[] }>) {
  const container = byId('thumbnail-selection');
  const grid = byId('thumbnail-grid');
  
  container.style.display = 'block';
  grid.innerHTML = '';
  
  images.forEach((img, idx) => {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    item.dataset.hash = img.hash;
    
    // Select first image by default (topmost)
    if (idx === images.length - 1) {
      item.classList.add('selected');
      selectedImageHash = img.hash;
    }
    
    const imgEl = document.createElement('img');
    if (img.thumbnail && img.thumbnail.length > 0) {
      // Convert array back to Uint8Array, then to blob
      const thumbnailBytes = new Uint8Array(img.thumbnail);
      const blob = new Blob([thumbnailBytes], { type: 'image/png' });
      imgEl.src = URL.createObjectURL(blob);
    } else {
      imgEl.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23ccc" width="100" height="100"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="%23999" font-size="12">No preview</text></svg>';
    }
    imgEl.alt = `Image ${img.index}`;
    
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = `Image ${img.index}${idx === images.length - 1 ? ' (topmost)' : ''}`;
    
    item.appendChild(imgEl);
    item.appendChild(label);
    
    item.addEventListener('click', () => {
      // Remove selection from all items
      grid.querySelectorAll('.thumbnail-item').forEach(el => el.classList.remove('selected'));
      // Add selection to clicked item
      item.classList.add('selected');
            selectedImageHash = img.hash;
            // Load metadata for selected image
      parent.postMessage({ pluginMessage: { type: 'load-metadata', imageHash: img.hash } }, '*');
    });
    
          grid.appendChild(item);
        });
      }

function hideThumbnailSelection() {
  const container = byId('thumbnail-selection');
  container.style.display = 'none';
}

function hideMetadataDisplay() {
  const container = byId('metadata-display');
  container.style.display = 'none';
}

function concatUint8(arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// Parse JPEG segments up to SOS
type JpegSegment = { marker: number; length: number; start: number; end: number; data: Uint8Array };

function parseJpegSegments(bytes: Uint8Array): JpegSegment[] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Not a JPEG');
  const segments: JpegSegment[] = [];
  let i = 2; // after SOI
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) {
      // In case of fill bytes, scan forward to next 0xFF
      i++;
      continue;
    }
    let marker = bytes[i + 1];
    i += 2;
    if (marker === 0xda) {
      // SOS - scan data until EOI
      break;
    }
    if (marker === 0xd9) {
      // EOI unexpected here
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // standalone markers with no length
      segments.push({ marker, length: 0, start: i - 2, end: i, data: bytes.subarray(i - 2, i) });
      continue;
    }
    if (i + 2 > bytes.length) break;
    const len = (bytes[i] << 8) | bytes[i + 1];
    const start = i - 2;
    const end = i + len;
    const seg = bytes.subarray(start, end);
    segments.push({ marker, length: len, start, end, data: seg });
    i = end;
  }
  return segments;
}

function isApp(marker: number): boolean {
  return marker >= 0xe0 && marker <= 0xef; // APP0..APP15
}

function mergeJpegMetadata(original: Uint8Array, rendered: Uint8Array): Uint8Array {
  // Collect metadata-bearing segments from original
  const origSegs = parseJpegSegments(original);
  const metaMarkers = new Set([0xe1, 0xe2, 0xed, 0xfe]); // APP1(EXIF/XMP), APP2(ICC), APP13(IPTC), COM
  const keepFromOriginal = origSegs.filter(s => metaMarkers.has(s.marker));

  // Parse rendered
  if (rendered[0] !== 0xff || rendered[1] !== 0xd8) throw new Error('Rendered is not JPEG');
  const rendSegs = parseJpegSegments(rendered);

  // Start with SOI
  const chunks: Uint8Array[] = [rendered.subarray(0, 2)];

  // Keep first APP0 (JFIF/JFXX) from rendered if present
  let idx = 0;
  if (rendSegs.length > 0 && rendSegs[0].marker === 0xe0) {
    chunks.push(rendSegs[0].data);
    idx = 1;
  }

  // Insert original metadata segments
  for (const seg of keepFromOriginal) {
    chunks.push(seg.data);
  }

  // Append the rest of rendered, skipping its own APP1/APP2/APP13/COM to avoid duplicates
  for (let i = idx; i < rendSegs.length; i++) {
    const seg = rendSegs[i];
    if (isApp(seg.marker) || seg.marker === 0xfe) {
      if (metaMarkers.has(seg.marker)) continue; // skip meta from rendered
      if (seg.marker === 0xe0 && idx === 1 && i === 0) continue; // already added APP0
    }
    chunks.push(seg.data);
  }

  // Append scan data (from SOS to end) untouched
  // Find SOS in rendered
  let sosIndex = 2;
  while (sosIndex + 1 < rendered.length) {
    if (rendered[sosIndex] === 0xff && rendered[sosIndex + 1] === 0xda) break;
    sosIndex++;
  }
  const rest = rendered.subarray(sosIndex);
  chunks.push(rest);

  return concatUint8(chunks);
}

function downloadBytes(bytes: Uint8Array, name: string, mime: string) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Single unified message handler
window.onmessage = async (event) => {
  const msg = event.data?.pluginMessage;
  if (!msg) {
    return;
  }
  
  if (msg.type === 'status') {
    setStatus(msg.message || '');
  } else if (msg.type === 'single-fill') {
    // Single image fill - hide thumbnail selection and proceed normally
    hideThumbnailSelection();
    selectedImageHash = msg.imageHash;
    // Metadata will be loaded automatically by code.ts
  } else if (msg.type === 'multiple-fills') {
    // Multiple image fills - show thumbnail selection
    showThumbnailSelection(msg.images || []);
  } else if (msg.type === 'no-selection') {
    hideThumbnailSelection();
    hideMetadataDisplay();
    setStatus('');
  } else if (msg.type === 'no-image-fills') {
    hideThumbnailSelection();
    hideMetadataDisplay();
    setStatus('Selected node does not have an image fill.');
  } else if (msg.type === 'process-jpeg') {
    try {
      setStatus('Merging metadata…');
      const original = new Uint8Array(msg.original);
      const rendered = new Uint8Array(msg.rendered);
      const merged = mergeJpegMetadata(original, rendered);
      downloadBytes(merged, msg.name || 'export.jpg', 'image/jpeg');
      setStatus('Done. File downloaded.');
    } catch (e) {
      console.error('[UI] JPEG processing error:', e);
      setStatus('Failed to merge metadata. Exported plain JPEG instead.');
      const fallback = new Uint8Array(msg.rendered);
      downloadBytes(fallback, msg.name || 'export.jpg', 'image/jpeg');
    }
  } else if (msg.type === 'check-selection') {
    // Re-check selection when it changes
    parent.postMessage({ pluginMessage: { type: 'check-multiple-fills' } }, '*');
  } else if (msg.type === 'metadata') {
    // Display metadata
    displayMetadata(msg.metadata);
  }
};

function displayMetadata(metadata: any) {
  const container = byId('metadata-display');
  const content = byId('metadata-content');
  
  if (!metadata) {
    container.style.display = 'none';
    return;
  }
  
  // Always show if we have dimensions at least
  if (!metadata.dimensions) {
    container.style.display = 'none';
    return;
  }
  
        container.style.display = 'block';
        
        // Helper to create a section
  const createSection = (title: string): { section: HTMLElement; list: HTMLElement; addItem: (label: string, value: string | null | undefined) => void } => {
    const section = document.createElement('div');
    section.className = 'metadata-section';
    
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'metadata-section-title';
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);
    
    const list = document.createElement('ul');
    list.className = 'metadata-list';
    section.appendChild(list);
    
    const addItem = (label: string, value: string | null | undefined) => {
      if (!value) return;
      const item = document.createElement('li');
      item.className = 'metadata-item';
      item.innerHTML = `
        <span class="metadata-label">${escapeHtml(label)}:</span>
        <span class="metadata-value">${escapeHtml(String(value))}</span>
      `;
      list.appendChild(item);
    };
    
    return { section, list, addItem };
  };
  
  const sections: HTMLElement[] = [];
  
  // ===== GENERAL SECTION =====
  const general = createSection('General');
  let hasGeneral = false;
  
  if (metadata.dimensions) {
    general.addItem('Dimensions', `${metadata.dimensions.width} × ${metadata.dimensions.height}`);
    hasGeneral = true;
  }
  
  if (metadata.icc?.description) {
    general.addItem('Color profile', metadata.icc.description);
    hasGeneral = true;
  } else if (metadata.icc?.present) {
    general.addItem('Color profile', 'Embedded');
    hasGeneral = true;
  }
  
  if (metadata.exif?.colorSpace) {
    general.addItem('Color space', metadata.exif.colorSpace);
    hasGeneral = true;
  }
  
  if (hasGeneral) {
    sections.push(general.section);
  }
  
  // ===== DESCRIPTIVE METADATA SECTION (IPTC/XMP) =====
  const descriptive = createSection('Descriptive');
  let hasDescriptive = false;
  
  // Keywords (from XMP/IPTC)
  if (metadata.xmp?.keywords && metadata.xmp.keywords.length > 0) {
    descriptive.addItem('Keywords', metadata.xmp.keywords.join(', '));
    hasDescriptive = true;
  } else if (metadata.iptc?.keywords && metadata.iptc.keywords.length > 0) {
    descriptive.addItem('Keywords', metadata.iptc.keywords.join(', '));
    hasDescriptive = true;
  }
  
  // Title
  if (metadata.xmp?.title) {
    descriptive.addItem('Title', metadata.xmp.title);
    hasDescriptive = true;
  }
  
  // Headline (prioritize IPTC over XMP, like macOS Finder)
  if (metadata.iptc?.headline) {
    descriptive.addItem('Headline', metadata.iptc.headline);
    hasDescriptive = true;
  } else if (metadata.xmp?.headline) {
    descriptive.addItem('Headline', metadata.xmp.headline);
    hasDescriptive = true;
  }
  
  // Description
  if (metadata.xmp?.description) {
    descriptive.addItem('Description', metadata.xmp.description);
    hasDescriptive = true;
  } else if (metadata.iptc?.caption) {
    descriptive.addItem('Description', metadata.iptc.caption);
    hasDescriptive = true;
  }
  
  // Credit (prioritize IPTC, then XMP credit)
  if (metadata.iptc?.credit) {
    descriptive.addItem('Credit', metadata.iptc.credit);
    hasDescriptive = true;
  } else if (metadata.xmp?.credit) {
    descriptive.addItem('Credit', metadata.xmp.credit);
    hasDescriptive = true;
  }
  
  // By-line (Photographer/Creator)
  if (metadata.iptc?.byline) {
    descriptive.addItem('By-line', metadata.iptc.byline);
    hasDescriptive = true;
  }
  
  // Contact
  if (metadata.iptc?.contact) {
    descriptive.addItem('Contact', metadata.iptc.contact);
    hasDescriptive = true;
  }
  
  // Instructions (Special Instructions)
  if (metadata.iptc?.instructions) {
    descriptive.addItem('Instructions', metadata.iptc.instructions);
    hasDescriptive = true;
  }
  
  if (hasDescriptive) {
    sections.push(descriptive.section);
  }
  
  // ===== LOCATION SECTION =====
  const location = createSection('Location');
  let hasLocation = false;
  
  if (metadata.iptc?.subLocation) {
    location.addItem('Sub-location', metadata.iptc.subLocation);
    hasLocation = true;
  }
  
  if (metadata.iptc?.city) {
    location.addItem('City', metadata.iptc.city);
    hasLocation = true;
  }
  
  if (metadata.iptc?.stateProvince) {
    location.addItem('State or Province', metadata.iptc.stateProvince);
    hasLocation = true;
  }
  
  if (metadata.iptc?.country) {
    location.addItem('Region', metadata.iptc.country);
    hasLocation = true;
  }
  
  if (hasLocation) {
    sections.push(location.section);
  }
  
  // ===== DATE/TIME SECTION =====
  const dateTime = createSection('Date & Time');
  let hasDateTime = false;
  
  // Format date created (YYYYMMDD -> YYYY-MM-DD)
  if (metadata.iptc?.dateCreated) {
    const dateStr = metadata.iptc.dateCreated;
    let formattedDate = dateStr;
    if (dateStr.length === 8 && /^\d{8}$/.test(dateStr)) {
      formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
    }
    dateTime.addItem('Date created', formattedDate);
    hasDateTime = true;
  }
  
  // Format time created (HHMMSS±HHMM -> HH:MM:SS ±HH:MM)
  if (metadata.iptc?.timeCreated) {
    const timeStr = metadata.iptc.timeCreated;
    let formattedTime = timeStr;
    if (timeStr.length >= 6 && /^\d{6}/.test(timeStr)) {
      formattedTime = `${timeStr.substring(0, 2)}:${timeStr.substring(2, 4)}:${timeStr.substring(4, 6)}`;
      if (timeStr.length > 6) {
        formattedTime += ` ${timeStr.substring(6)}`;
      }
    }
    dateTime.addItem('Time created', formattedTime);
    hasDateTime = true;
  }
  
  if (hasDateTime) {
    sections.push(dateTime.section);
  }
  
  // ===== CAMERA SECTION (EXIF) =====
  const camera = createSection('Camera');
  let hasCamera = false;
  
  if (metadata.exif?.make) {
    camera.addItem('Device make', metadata.exif.make);
    hasCamera = true;
  }
  
  if (metadata.exif?.model) {
    camera.addItem('Device model', metadata.exif.model);
    hasCamera = true;
  }
  
  if (metadata.exif?.focalLength) {
    camera.addItem('Focal length', metadata.exif.focalLength);
    hasCamera = true;
  }
  
  if (metadata.exif?.fNumber) {
    camera.addItem('F number', metadata.exif.fNumber);
    hasCamera = true;
  }
  
  if (metadata.exif?.exposureTime) {
    camera.addItem('Exposure time', metadata.exif.exposureTime);
    hasCamera = true;
  }
  
  if (metadata.exif?.iso !== undefined) {
    camera.addItem('ISO speed', String(metadata.exif.iso));
    hasCamera = true;
  }
  
  if (metadata.exif?.exposureProgram) {
    camera.addItem('Exposure program', metadata.exif.exposureProgram);
    hasCamera = true;
  }
  
  if (metadata.exif?.meteringMode) {
    camera.addItem('Metering mode', metadata.exif.meteringMode);
    hasCamera = true;
  }
  
  if (metadata.exif?.dateTimeOriginal) {
    camera.addItem('Date taken', metadata.exif.dateTimeOriginal);
    hasCamera = true;
  } else if (metadata.exif?.dateTime) {
    camera.addItem('Date taken', metadata.exif.dateTime);
    hasCamera = true;
  }
  
  if (hasCamera) {
    sections.push(camera.section);
  }
  
  // ===== OTHER SECTION =====
  const other = createSection('Other');
  let hasOther = false;
  
  if (metadata.exif?.hasAlpha !== undefined) {
    other.addItem('Alpha channel', metadata.exif.hasAlpha ? 'Yes' : 'No');
    hasOther = true;
  }
  
  if (metadata.exif?.redEye !== undefined) {
    other.addItem('Red eye', metadata.exif.redEye ? 'Yes' : 'No');
    hasOther = true;
  }
  
  if (hasOther) {
    sections.push(other.section);
  }
  
  // Render all sections
  if (sections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'metadata-empty';
    empty.textContent = 'No metadata found in this image.';
    content.innerHTML = '';
    content.appendChild(empty);
  } else {
    content.innerHTML = '';
    sections.forEach(section => content.appendChild(section));
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

      document.addEventListener('DOMContentLoaded', () => {
        // Check for multiple fills when plugin loads
  parent.postMessage({ pluginMessage: { type: 'check-multiple-fills' } }, '*');
  
  const exportBtn = byId('export');
  const closeBtn = byId('close');
  
        exportBtn.addEventListener('click', async () => {
          // Re-check selection before exporting (in case it changed)
          parent.postMessage({ pluginMessage: { type: 'check-multiple-fills' } }, '*');
          
          // Small delay to allow check to complete if needed
          await new Promise(resolve => setTimeout(resolve, 200));
          
          const scale = getSelectedScale();
          setStatus('Exporting…');
    parent.postMessage({ 
      pluginMessage: { 
        type: 'export', 
        scale,
        selectedImageHash: selectedImageHash || undefined
      } 
    }, '*');
  });
  
        closeBtn.addEventListener('click', () => {
          parent.postMessage({ pluginMessage: { type: 'close' } }, '*');
        });
      });

// Message handler is already set above with window.onmessage


