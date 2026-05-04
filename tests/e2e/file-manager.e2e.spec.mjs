import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("file manager UI supports core folder and file operations", async ({ page }) => {
  await page.goto("/files");
  await expect(page.getByTestId("file-manager")).toBeVisible();
  await expect(page.getByText("This folder is empty.")).toBeVisible();

  await createFolder(page, "Projects");
  await createFolder(page, "Inbox");
  await createFolder(page, "MovedFolder");

  await uploadFile(page, "hello.txt", "hello files");
  await renameSelectedItem(page, "hello.txt", "hello-renamed.txt");
  await downloadAndExpect(page, "hello-renamed.txt", "hello files");

  await moveSelectedItemIntoFolder(page, "hello-renamed.txt", "Projects");
  await expect(page.getByTestId("file-item-hello-renamed.txt")).toBeVisible();
  await page.getByTestId("breadcrumb-home").click();
  await expect(page.getByTestId("file-item-hello-renamed.txt")).toHaveCount(0);

  await uploadFile(page, "copy-me.txt", "copy me");
  await copySelectedItemIntoFolder(page, "copy-me.txt", "Inbox");
  await expect(page.getByTestId("file-item-copy-me.txt")).toBeVisible();
  await page.getByTestId("breadcrumb-home").click();
  await expect(page.getByTestId("file-item-copy-me.txt")).toBeVisible();

  await moveSelectedItemIntoFolder(page, "MovedFolder", "Inbox");
  await expect(page.getByTestId("file-item-MovedFolder")).toBeVisible();
  await page.getByTestId("breadcrumb-home").click();
  await expect(page.getByTestId("file-item-MovedFolder")).toHaveCount(0);

  await deleteSelectedItem(page, "copy-me.txt");
  await expect(page.getByTestId("file-item-copy-me.txt")).toHaveCount(0);
  await deleteSelectedItem(page, "Projects");
  await deleteSelectedItem(page, "Inbox");
  await expect(page.getByText("This folder is empty.")).toBeVisible();
});

async function createFolder(page, name) {
  await page.getByTestId("toolbar-new-folder").click();
  await page.locator("#newFolder").fill(name);
  await page.locator("#newFolder").press("Enter");
  await expect(page.getByTestId(`file-item-${name}`)).toBeVisible();
}

async function uploadFile(page, name, content) {
  await page.getByTestId("toolbar-upload").click();
  await page.locator("#chooseFile").setInputFiles({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(content),
  });
  await expect(page.getByTestId(`file-item-${name}`)).toBeVisible();
  await page.getByTestId("modal-close").click();
}

async function selectItem(page, name) {
  const item = page.getByTestId(`file-item-${name}`);
  await item.hover();
  await item.locator('input[type="checkbox"]').check({ force: true });
  await expect(page.getByTestId("toolbar-clear-selection")).toBeVisible();
}

async function renameSelectedItem(page, fromName, toName) {
  await selectItem(page, fromName);
  await page.getByTestId("toolbar-rename").click();
  await page.locator("textarea.rename-file").fill(toName);
  await page.locator("textarea.rename-file").press("Enter");
  await expect(page.getByTestId(`file-item-${toName}`)).toBeVisible();
}

async function downloadAndExpect(page, name, expectedContent) {
  await selectItem(page, name);
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("toolbar-download").click();
  const download = await downloadPromise;
  const targetPath = path.join(os.tmpdir(), `${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(targetPath);
  await expect(await readFile(targetPath, "utf8")).toBe(expectedContent);
}

async function moveSelectedItemIntoFolder(page, itemName, folderName) {
  await selectItem(page, itemName);
  await page.getByTestId("toolbar-cut").click();
  await openFolder(page, folderName);
  await page.getByTestId("toolbar-paste").click();
  await expect(page.getByTestId(`file-item-${itemName}`)).toBeVisible();
}

async function copySelectedItemIntoFolder(page, itemName, folderName) {
  await selectItem(page, itemName);
  await page.getByTestId("toolbar-copy").click();
  await openFolder(page, folderName);
  await page.getByTestId("toolbar-paste").click();
  await expect(page.getByTestId(`file-item-${itemName}`)).toBeVisible();
}

async function openFolder(page, name) {
  await page.getByTestId(`file-item-${name}`).dblclick();
  await expect(page.getByTestId(`breadcrumb-${name}`)).toBeVisible();
}

async function deleteSelectedItem(page, name) {
  await selectItem(page, name);
  await page.getByTestId("toolbar-delete").click();
  await page.getByTestId("modal").getByRole("button", { name: "Delete" }).click();
}
