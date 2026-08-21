import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Game } from '../types/game';

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    publisherId: publishers.id,
    publisherName: publishers.name,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    publisherId: number | null;
    publisherName: string | null;
};

export type GameFilterValue = number | number[] | null | undefined;

export interface GameFilters {
    categoryId?: GameFilterValue;
    categoryIds?: GameFilterValue;
    publisherId?: GameFilterValue;
    publisherIds?: GameFilterValue;
}

function normalizeFilterValues(value: GameFilterValue): number[] {
    if (value === null || value === undefined) {
        return [];
    }

    const ids = Array.isArray(value) ? value : [value];
    return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

export async function getAllCategories(db: Database): Promise<Array<{ id: number; name: string }>> {
    return db
        .select({ id: categories.id, name: categories.name })
        .from(categories)
        .orderBy(asc(categories.name));
}

export async function getAllPublishers(db: Database): Promise<Array<{ id: number; name: string }>> {
    return db
        .select({ id: publishers.id, name: publishers.name })
        .from(publishers)
        .orderBy(asc(publishers.name));
}

/**
 * Return every game, including its linked category and publisher, ordered by title.
 *
 * @param db - Injected database client used by pages and in-memory tests.
 * @param filters - Optional category and publisher restrictions applied with AND semantics.
 * @returns Games ordered alphabetically by title with the related metadata mapped to the app model.
 */
export async function getAllGames(db: Database, filters: GameFilters = {}): Promise<Game[]> {
    const categoryIds = normalizeFilterValues(filters.categoryId ?? filters.categoryIds);
    const publisherIds = normalizeFilterValues(filters.publisherId ?? filters.publisherIds);

    const conditions = [];

    if (categoryIds.length > 0) {
        conditions.push(inArray(categories.id, categoryIds));
    }

    if (publisherIds.length > 0) {
        conditions.push(inArray(publishers.id, publisherIds));
    }

    const query = conditions.length > 0 ? baseGamesQuery(db).where(and(...conditions)) : baseGamesQuery(db);
    const rows = await query.orderBy(asc(games.title));
    return rows.map(mapGame);
}

export async function getGamesByCategory(db: Database, categoryId: number | number[]): Promise<Game[]> {
    return getAllGames(db, { categoryId });
}

export async function getGamesByPublisher(db: Database, publisherId: number | number[]): Promise<Game[]> {
    return getAllGames(db, { publisherId });
}

export async function getFilteredGames(db: Database, filters: GameFilters = {}): Promise<Game[]> {
    return getAllGames(db, filters);
}

/**
 * Return every game id ordered by title for static route generation.
 *
 * @param db - Injected database client used by pages and in-memory tests.
 * @returns The game identifiers in alphabetical title order.
 */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/**
 * Fetch one game by id, including its category and publisher metadata when present.
 *
 * @param db - Injected database client used by pages and in-memory tests.
 * @param id - Primary key to look up.
 * @returns The matching game, or `null` when no row exists for that id.
 */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
