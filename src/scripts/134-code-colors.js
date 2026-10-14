/*
 * Technically Not · 134-code-colors.js — Colors the code of a file that is read in the Files
 * column (131), by its language: keywords, strings, comments, numbers and names each get the color
 * most editors use for them. The language comes from the file's name. Plain text, logs and kinds
 * that are not known stay as they are, and so does a very long file, which would make the reader
 * slow to open. The words are split by highlight.js (src/vendor/highlight); the colors are in
 * 37-code-colors.css.
 */
(() => {
  // A file longer than this is shown without colors.
  const MAX_CHARS = 300000;

  // The ending of a file's name, and the language it is written in.
  const BY_ENDING = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    jsonc: 'json',
    webmanifest: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'xml',
    htm: 'xml',
    xml: 'xml',
    svg: 'xml',
    xaml: 'xml',
    vue: 'xml',
    md: 'markdown',
    markdown: 'markdown',
    py: 'python',
    pyw: 'python',
    rb: 'ruby',
    php: 'php',
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    swift: 'swift',
    go: 'go',
    rs: 'rust',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    vb: 'vbnet',
    m: 'objectivec',
    mm: 'objectivec',
    lua: 'lua',
    pl: 'perl',
    r: 'r',
    sql: 'sql',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    psm1: 'powershell',
    psd1: 'powershell',
    bat: 'dos',
    cmd: 'dos',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    ini: 'ini',
    cfg: 'ini',
    conf: 'ini',
    properties: 'ini',
    editorconfig: 'ini',
    diff: 'diff',
    patch: 'diff',
    graphql: 'graphql',
    gql: 'graphql',
    mk: 'makefile',
    wat: 'wasm',
  };

  // Files known by their whole name.
  const BY_NAME = {
    dockerfile: 'dockerfile',
    makefile: 'makefile',
    '.gitignore': 'ini',
    '.gitattributes': 'ini',
    '.npmrc': 'ini',
    '.prettierrc': 'json',
    '.eslintrc': 'json',
    '.babelrc': 'json',
    '.bashrc': 'bash',
    '.zshrc': 'bash',
  };

  // The language of a file by its name, or '' when it is read as plain text.
  function languageOf(name) {
    const file = String(name || '')
      .split(/[\\/]/)
      .pop()
      .toLowerCase();
    if (BY_NAME[file]) return BY_NAME[file];
    const dot = file.lastIndexOf('.');
    return dot > 0 ? BY_ENDING[file.slice(dot + 1)] || '' : '';
  }

  // Puts a file's text into its box, colored when its language is known. Returns the language
  // used, or '' when the text was put in plain.
  function paint(box, text, name) {
    const highlighter = window.hljs;
    const language = languageOf(name);
    delete box.dataset.language;
    if (
      !highlighter ||
      !language ||
      !highlighter.getLanguage(language) ||
      text.length > MAX_CHARS
    ) {
      box.textContent = text;
      return '';
    }
    try {
      // highlight.js writes the text as HTML with every sign of the file made harmless
      box.innerHTML = highlighter.highlight(text, { language, ignoreIllegals: true }).value;
      box.dataset.language = language;
      return language;
    } catch {
      box.textContent = text;
      return '';
    }
  }

  window.TnaiCodeColors = { paint, languageOf };
})();
