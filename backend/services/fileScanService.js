import logger from '../utils/logger.js';

/**
 * File scanning service (Section 19.5).
 * Provides a scanning integration point. In production, this would call an
 * external scanner (ClamAV, VirusTotal, etc.). In test/dev mode (no scanner
 * configured), files are marked as 'clean' (skipped) with a clear log entry.
 */

const SCANNER_URL = process.env.MALWARE_SCANNER_URL || '';

/**
 * Scan a file buffer. Returns { status: 'clean'|'infected'|'error'|'skipped', result: string }.
 */
export const scanFile = async (buffer, mimeType, filename) => {
  if (!SCANNER_URL) {
    // No scanner configured — mark as skipped (not scanned)
    logger.warn(`No malware scanner configured (MALWARE_SCANNER_URL). File "${filename}" marked as skipped.`);
    return { status: 'skipped', result: 'No scanner configured. File not scanned.' };
  }

  try {
    // Placeholder for real scanner integration (e.g., ClamAV REST API)
    const res = await fetch(SCANNER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: buffer,
    });
    const data = await res.json();
    if (data.infected) {
      return { status: 'infected', result: data.threat || 'Malware detected' };
    }
    return { status: 'clean', result: 'No threats detected' };
  } catch (err) {
    logger.error(`Malware scan failed for "${filename}": ${err.message}`);
    return { status: 'error', result: `Scan error: ${err.message}` };
  }
};
