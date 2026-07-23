import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

function slugify(pathname) {
  const cleaned = pathname
    .toLowerCase()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .pop() || '';
  const slug = cleaned.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'pair';
}

function dedupeSlug(slug, usedSlugs) {
  if (!usedSlugs.has(slug)) {
    usedSlugs.add(slug);
    return slug;
  }
  let suffix = 2;
  let candidate = `${slug}-${suffix}`;
  while (usedSlugs.has(candidate)) {
    suffix += 1;
    candidate = `${slug}-${suffix}`;
  }
  usedSlugs.add(candidate);
  return candidate;
}

function validateRow(row, rowNumber) {
  if (!row.liveUrl || typeof row.liveUrl !== 'string') {
    throw new Error(`Mapping file row ${rowNumber}: missing or invalid liveUrl.`);
  }
  if (!row.migratedUrl || typeof row.migratedUrl !== 'string') {
    throw new Error(`Mapping file row ${rowNumber}: missing or invalid migratedUrl.`);
  }
}

function parseCsv(content) {
  const lines = content.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((column) => column.trim().toLowerCase());
  const liveIndex = header.indexOf('liveurl');
  const migratedIndex = header.indexOf('migratedurl');
  if (liveIndex === -1 || migratedIndex === -1) {
    throw new Error('CSV mapping file must have a header row with liveUrl and migratedUrl columns.');
  }
  return lines.slice(1).map((line) => {
    const columns = line.split(',').map((column) => column.trim());
    return { liveUrl: columns[liveIndex], migratedUrl: columns[migratedIndex] };
  });
}

export async function parseMappingFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (ext !== '.csv' && ext !== '.json') {
    throw new Error(`Unsupported mapping file "${filePath}": must be .csv or .json.`);
  }

  const content = await readFile(filePath, 'utf8');
  const rows = ext === '.json' ? JSON.parse(content) : parseCsv(content);

  if (!Array.isArray(rows)) {
    throw new Error('JSON mapping file must contain an array of { liveUrl, migratedUrl } objects.');
  }

  const usedSlugs = new Set();
  return rows.map((row, index) => {
    validateRow(row, index + 1);
    const pathname = new URL(row.migratedUrl).pathname;
    const slug = dedupeSlug(slugify(pathname), usedSlugs);
    return { liveUrl: row.liveUrl, migratedUrl: row.migratedUrl, pairSlug: slug };
  });
}
