/**
 * Pure, side-effect-free helpers for turning the seed CSV into database
 * records. Kept separate from any database access so they can be unit tested
 * in isolation and reused by the seed script.
 */

export interface GameCsvRow {
    title: string;
    category: string;
    publisher: string;
    description: string;
}

const CROWDFUNDING_BLURB = ' Support this game through our crowdfunding platform!';

/**
 * Parse a CSV payload into objects keyed by each column name.
 *
 * @param content - Raw CSV text that may contain quoted values, escaped quotes,
 * and multiline fields.
 * @returns A row array where each object maps a header name to the parsed cell value.
 */
export function parseCsv(content: string): Record<string, string>[] {
    const records: string[][] = [];
    let field = '';
    let record: string[] = [];
    let inQuotes = false;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (inQuotes) {
            if (char === '"') {
                if (content[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            record.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            // Skip the paired newline in CRLF so Windows files are parsed as one record break.
            if (char === '\r' && content[i + 1] === '\n') {
                i++;
            }
            record.push(field);
            field = '';
            if (record.some((value) => value.length > 0) || record.length > 1) {
                records.push(record);
            }
            record = [];
        } else {
            field += char;
        }
    }

    // Preserve the trailing row when a file finishes without a final newline.
    if (field.length > 0 || record.length > 0) {
        record.push(field);
        if (record.some((value) => value.length > 0)) {
            records.push(record);
        }
    }

    if (records.length === 0) {
        return [];
    }

    const [header, ...rows] = records;
    return rows.map((row) => {
        const entry: Record<string, string> = {};
        header.forEach((key, index) => {
            entry[key] = row[index] ?? '';
        });
        return entry;
    });
}

/**
 * Parse the seed CSV into the typed rows the database expects.
 *
 * @param content - CSV text exported from the games spreadsheet.
 * @returns Simplified game rows with trimmed values for the fields we persist.
 */
export function parseGamesCsv(content: string): GameCsvRow[] {
   return parseCsv(content)
       .filter((row) => (row.Title ?? '').trim().length > 0)
       .map((row) => ({
           title: row.Title.trim(),
           category: row.Category.trim(),
           publisher: row.Publisher.trim(),
           description: row.Description.trim(),
       }));
}

/**
 * Build the category blurb shown in the seeded database.
 *
 * @param name - Category name used in the description.
 * @returns A reusable description for the category record.
 */
export function categoryDescription(name: string): string {
   return `Collection of ${name} games available for crowdfunding`;
}

/**
 * Build the publisher blurb shown in the seeded database.
 *
 * @param name - Publisher name used in the description.
 * @returns A reusable description for the publisher record.
 */
export function publisherDescription(name: string): string {
   return `${name} is a game publisher seeking funding for exciting new titles`;
}

/**
 * Append the crowdfunding CTA to a raw game summary.
 *
 * @param rawDescription - Original description from the seed file.
 * @returns The description with the platform-specific call to action appended.
 */
export function gameDescription(rawDescription: string): string {
   return rawDescription + CROWDFUNDING_BLURB;
}

/**
 * Return the category names in first-seen order without duplicates.
 *
 * @param rows - Parsed CSV rows to de-duplicate.
 * @returns Category names in their original order after removing repeats.
 */
export function uniqueCategories(rows: GameCsvRow[]): string[] {
   return [...new Set(rows.map((row) => row.category))];
}

/**
 * Return the publisher names in first-seen order without duplicates.
 *
 * @param rows - Parsed CSV rows to de-duplicate.
 * @returns Publisher names in their original order after removing repeats.
 */
export function uniquePublishers(rows: GameCsvRow[]): string[] {
   return [...new Set(rows.map((row) => row.publisher))];
}

/**
 * Deterministically derive a star rating in [3.0, 5.0] (one decimal place)
 * from a game title.
 *
 * @param title - Game title used to keep the rating stable across builds.
 * @returns A deterministic rating between 3.0 and 5.0 rounded to one decimal place.
 */
export function ratingFromTitle(title: string): number {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
        hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
    }
    // 21 buckets -> 3.0, 3.1, ... 5.0
    const tenths = hash % 21;
    return Math.round((3.0 + tenths / 10) * 10) / 10;
}
