import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("file manager UI supports core folder and file operations", async ({ page }) => {
  await page.request.put("/api/config", {
    data: { acceptedFileTypes: ".txt, .png, .jpg, .jpeg, .pdf, .doc, .docx, .exe" },
  });
  await page.goto("/files");
  await expect(page.getByTestId("file-manager")).toBeVisible();
  await expectFileManagerToFillViewport(page);
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

test("file manager UI uses server allowed file config", async ({ page }) => {
  await page.request.put("/api/config", {
    data: { allowedExtensions: [".txt"] },
  });
  await page.goto("/files");
  await page.getByTestId("toolbar-upload").click();
  await page.locator("#chooseFile").setInputFiles({
    name: "blocked.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });

  await expect(page.getByText("File type is not allowed.")).toBeVisible();
  await expect(page.getByTestId("file-item-blocked.pdf")).toHaveCount(0);
});

test("file manager UI allows wildcard uploads but reports blocked extensions", async ({ page }) => {
  await page.request.put("/api/config", {
    data: { allowedExtensions: "*", blockedExtensions: [".pdf"] },
  });
  await page.goto("/files");
  await page.getByTestId("toolbar-upload").click();
  await page.locator("#chooseFile").setInputFiles({
    name: "blocked-by-deny-list.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4"),
  });

  await expect(page.getByText("Upload failed.")).toBeVisible();
  await expect(page.getByTestId("file-item-blocked-by-deny-list.pdf")).toHaveCount(0);
});

test("file manager UI opens workspace source deep links and disables read-only writes", async ({ page }) => {
  const workspaceFiles = workspaceSourceFixture();
  await page.route("**/api/sources", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sources: [
          { sourceId: "local-data-root", label: "Local files", status: "ok" },
          { sourceId: "service-lasso-workspaces", label: "Service workspaces", status: "ok" },
          {
            sourceId: "unavailable-source",
            label: "Unavailable source",
            status: "unavailable",
            error: "Registry unavailable",
          },
        ],
      }),
    });
  });
  await page.route("**/api/file-system", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(workspaceFiles),
      });
      return;
    }

    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "Workspace root is read-only." }),
    });
  });

  await page.goto("/files?source=service-lasso-workspaces&service=nginx&root=config&path=/runtime");

  await expect(page.getByTestId("source-picker")).toHaveValue("service-lasso-workspaces");
  await expect(page.getByTestId("breadcrumb-nginx")).toBeVisible();
  await expect(page.getByTestId("breadcrumb-Config")).toBeVisible();
  await expect(page.getByTestId("breadcrumb-runtime")).toBeVisible();
  await expect(page.getByTestId("source-mode")).toHaveText("Read only");
  await expect(page.getByTestId("file-item-nginx.conf")).toBeVisible();
  await expect(page.getByTestId("toolbar-new-folder")).toBeDisabled();
  await expect(page.getByTestId("toolbar-upload")).toBeDisabled();

  await selectItem(page, "nginx.conf");
  await expect(page.getByTestId("toolbar-cut")).toBeDisabled();
  await expect(page.getByTestId("toolbar-rename")).toBeDisabled();
  await expect(page.getByTestId("toolbar-delete")).toBeDisabled();

  await page.getByTestId("toolbar-clear-selection").click();
  await page.getByTestId("source-picker").selectOption("local-data-root");
  await expect(page.getByTestId("file-item-local-note.txt")).toBeVisible();
  await expect(page.getByTestId("file-item-nginx.conf")).toHaveCount(0);
  await expect(page.getByTestId("toolbar-new-folder")).toBeEnabled();
  await expect(page.getByTestId("toolbar-upload")).toBeEnabled();

  await page.getByTestId("source-picker").selectOption("unavailable-source");
  await expect(page.getByTestId("source-state")).toContainText("Source unavailable");
  await expect(page.getByTestId("source-state")).toContainText("Registry unavailable");
});

async function expectFileManagerToFillViewport(page) {
  const viewport = page.viewportSize();
  const box = await page.getByTestId("file-manager").boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(viewport.width * 0.9);
  expect(box.height).toBeGreaterThan(viewport.height * 0.9);
}

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

function workspaceSourceFixture() {
  return [
    {
      _id: "local-note",
      name: "local-note.txt",
      isDirectory: false,
      path: "/local-note.txt",
      parentId: null,
      size: 12,
    },
    {
      _id: "workspace-service-nginx",
      name: "nginx",
      isDirectory: true,
      path: "/nginx",
      parentId: null,
      sourceId: "service-lasso-workspaces",
      serviceId: "nginx",
      virtual: true,
    },
    {
      _id: "workspace-nginx-workspace",
      name: "Workspace",
      isDirectory: true,
      path: "/nginx/Workspace",
      parentId: "workspace-service-nginx",
      sourceId: "service-lasso-workspaces",
      serviceId: "nginx",
      rootId: "workspace",
      mode: "read-write",
      virtual: true,
    },
    {
      _id: "workspace-nginx-config",
      name: "Config",
      isDirectory: true,
      path: "/nginx/Config",
      parentId: "workspace-service-nginx",
      sourceId: "service-lasso-workspaces",
      serviceId: "nginx",
      rootId: "config",
      mode: "read-only",
      readOnly: true,
      virtual: true,
    },
    {
      _id: "workspace-nginx-config-runtime",
      name: "runtime",
      isDirectory: true,
      path: "/nginx/Config/runtime",
      parentId: "workspace-nginx-config",
      sourceId: "service-lasso-workspaces",
      serviceId: "nginx",
      rootId: "config",
      mode: "read-only",
      readOnly: true,
    },
    {
      _id: "workspace-nginx-conf",
      name: "nginx.conf",
      isDirectory: false,
      path: "/nginx/Config/runtime/nginx.conf",
      parentId: "workspace-nginx-config-runtime",
      sourceId: "service-lasso-workspaces",
      serviceId: "nginx",
      rootId: "config",
      mode: "read-only",
      readOnly: true,
      size: 9,
    },
  ];
}
