import { test, expect } from '@playwright/test';

test.describe('Home Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the correct title', async ({ page }) => {
    // Check that the page title is correct
    await expect(page).toHaveTitle('Tailspin Toys - Crowdfunding your new favorite game!');
  });

  test('should display the main heading', async ({ page }) => {
    // Check that the main page heading is present
    await expect(page.getByRole('heading', { name: 'Welcome to Tailspin Toys', exact: true })).toBeVisible();
  });

  test('should display the site branding in header', async ({ page }) => {
    // Check that the site branding is present in the header (no longer an h1)
    await expect(page.getByText('Tailspin Toys').first()).toBeVisible();
  });

  test('should display the welcome message', async ({ page }) => {
    // Check that the welcome message is present using more specific locator
    await expect(page.getByText('Find your next game! And maybe even back one! Explore our collection!')).toBeVisible();
  });

  test('should filter the game list by category', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'Filter games by Strategy' }).check();

    await expect(page.getByRole('link', { name: /DevOps Dominion/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Code Puzzle Chronicles/i })).not.toBeVisible();
    await expect(page.getByText('Showing 4 games')).toBeVisible();
  });

  test('should filter the game list by publisher', async ({ page }) => {
    await page.getByTestId('publisher-filter').selectOption({ label: 'CodeForge Studios' });

    await expect(page.getByRole('link', { name: /DevOps Dominion/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Pipeline Conquest/i })).not.toBeVisible();
    await expect(page.getByText('Showing 6 games')).toBeVisible();
  });

  test('should combine category and publisher filters', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'Filter games by Strategy' }).check();
    await page.getByRole('checkbox', { name: 'Filter games by Puzzle' }).check();
    await page.getByTestId('publisher-filter').selectOption({ label: 'CodeForge Studios' });

    await expect(page.getByRole('link', { name: /DevOps Dominion/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Code Puzzle Chronicles/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Pipeline Conquest/i })).not.toBeVisible();
    await expect(page.getByText('Showing 2 games')).toBeVisible();
  });
});
