// The native folder picker cannot be automated. Replace it with a real origin-private (OPFS)
// directory so every read, write, and reread still goes through real browser file handles.
window.__seed = (async () => {
  const storage = await navigator.storage.getDirectory();
  if (check.phase === '1') {
    for await (const key of storage.keys()) await storage.removeEntry(key, { recursive: true });
    const project = await storage.getDirectoryHandle('demo-project', { create: true }),
      src = await project.getDirectoryHandle('src', { create: true }),
      many = await project.getDirectoryHandle('big-folder', { create: true });
    const put = async (dir, name, data) => {
      const file = await dir.getFileHandle(name, { create: true }),
        writable = await file.createWritable();
      await writable.write(data);
      await writable.close();
    };
    await put(src, 'app.ts', 'export const a = 1;\r\nexport const b = 2;\r\n');
    await put(project, 'README.md', '# Demo\n');
    await put(project, 'logo.png', new Uint8Array([137, 80, 78, 71, 0, 0, 0, 13, 1, 2, 3]));
    await put(project, 'latin1.txt', new Uint8Array([0x63, 0x61, 0x66, 0xe9]));
    for (let i = 0; i < 1003; i++) await put(many, 'f' + i + '.txt', 'x');
  }
  return storage.getDirectoryHandle('demo-project');
})();
window.showDirectoryPicker = async () => window.__seed;
