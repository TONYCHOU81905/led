import path from 'node:path'
import { test as base, expect, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const APP_ROOT = path.resolve(__dirname, '..')

type Fixtures = {
  electronApp: ElectronApplication
  window: Page
}

export const test = base.extend<Fixtures>({
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      cwd: APP_ROOT,
      args: ['.'],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      }
    })
    await use(app)
    await app.close()
  },
  window: async ({ electronApp }, use) => {
    const win = await electronApp.firstWindow()
    await win.waitForLoadState('domcontentloaded')
    await expect(win.locator('nav.sidebar')).toBeVisible()
    await win.locator('nav.sidebar').getByRole('link', { name: 'Dashboard' }).click()
    await expect(win.locator('main.content h1')).toBeVisible({ timeout: 15_000 })
    await use(win)
  }
})

export { expect }

export async function createProject(window: Page, name = 'E2E 演出') {
  await window.getByRole('button', { name: '新建專案' }).click()
  const dialog = window.locator('.modal-panel')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: '建立' }).click()
  await expect(window.locator('.project-name')).toHaveText(name)
}

export async function nav(window: Page, label: string) {
  await window.locator('nav.sidebar').getByRole('link', { name: label }).click()
}
