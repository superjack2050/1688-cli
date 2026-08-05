import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { getCategoryTree, searchCategories } = require('../apps/desktop/ozon-settings.cjs') as {
  getCategoryTree: (userDataPath: string, options?: Record<string, unknown>) => Promise<Record<string, any>>;
  searchCategories: (userDataPath: string, query?: string, options?: Record<string, unknown>) => Promise<Record<string, any>>;
};

const tempDirs: string[] = [];
const originalAppData = process.env.APPDATA;

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function sampleTree() {
  return {
    result: [{
      description_category_id: 1700,
      category_name: '配件',
      children: [{
        description_category_id: 1700,
        type_id: 9300,
        type_name: '手机壳',
        children: [],
      }],
    }],
  };
}

afterEach(async () => {
  process.env.APPDATA = originalAppData;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('Ozon category tree cache compatibility', () => {
  it('loads and searches the canonical categories cache without store credentials', async () => {
    const userData = await makeTempDir('ozon-settings-');
    const categoryDir = path.join(userData, 'categories');
    await fs.mkdir(categoryDir, { recursive: true });
    await fs.writeFile(path.join(categoryDir, 'ozon_category_tree.zh_hans.json'), JSON.stringify(sampleTree()), 'utf8');

    const tree = await getCategoryTree(userData, { language: 'ZH_HANS' });
    const search = await searchCategories(userData, '手机壳', { language: 'ZH_HANS' });

    expect(tree).toMatchObject({ ok: true, source: 'cache', total: 1 });
    expect(search.items).toEqual([
      expect.objectContaining({ keyword: '手机壳', description_category_id: 1700, type_id: 9300 }),
    ]);
  });

  it('recovers the stable desktop cache when development Electron uses a different userData folder', async () => {
    const appData = await makeTempDir('ozon-appdata-');
    const devUserData = await makeTempDir('ozon-electron-');
    process.env.APPDATA = appData;
    const stableCategoryDir = path.join(appData, '1688ToOzonStudio', 'app', 'categories');
    await fs.mkdir(stableCategoryDir, { recursive: true });
    await fs.writeFile(path.join(stableCategoryDir, 'ozon_category_tree.zh_hans.json'), JSON.stringify(sampleTree()), 'utf8');

    const tree = await getCategoryTree(devUserData, { language: 'ZH_HANS' });

    expect(tree).toMatchObject({ ok: true, source: 'cache', total: 1 });
  });
});
