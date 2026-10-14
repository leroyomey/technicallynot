// Technically Not · 20-code-highlight.js — Syntax colors per language for 09’s editor layer (a
// colored <pre> under a transparent-text textarea); `window.TnaiCodeHighlight`.
(() => {
  const editor = document.querySelector('.repo-editor');
  const body = editor?.querySelector('.repo-editor-body');
  if (!editor || !body) return;

  // Above this many characters the editor stays plain text (measured: see
  // tools/desktop-check/tests/code-highlight.js).
  const HIGHLIGHT_LIMIT = 1024 * 1024;

  // A highlight pass slower than this switches typing from per-frame to debounced updates.
  const SLOW_MS = 40;

  // Lines rendered above and below the visible part of the editor.
  const MARGIN = 80;

  const style = document.createElement('style');
  style.textContent = `
.repo-code-wrap{display:grid;grid-template:minmax(0,1fr)/minmax(0,1fr);min-width:0;min-height:0}
.repo-code-wrap>*{grid-area:1/1;min-width:0}
.repo-code-layer{display:none;box-sizing:border-box;width:100%;height:100%;min-height:220px;margin:0;padding:12px 14px;border:1px solid transparent;border-radius:6px;background:#fbfcf9;color:#34382f;font:12px/1.55 Consolas,'Cascadia Mono',Menlo,monospace;font-variant-ligatures:none;tab-size:2;white-space:pre;overflow:hidden;pointer-events:none;contain:strict}
.repo-code-layer>code{display:block;font:inherit;white-space:inherit;will-change:transform}
.repo-code-wrap.hl>.repo-code-layer{display:block}
.repo-code-wrap.hl:focus-within>.repo-code-layer{background:#fff}
.repo-code-wrap.hl.readonly>.repo-code-layer{background:#f7f8f5}
.repo-code-wrap.hl>.repo-editor-text,.repo-code-wrap.hl>.repo-editor-text:focus,.repo-code-wrap.hl>.repo-editor-text[readonly]{position:relative;background:transparent;color:transparent;caret-color:#34382f;font-variant-ligatures:none}
.repo-code-wrap.hl>.repo-editor-text::selection{background:#b9cca466;color:transparent}
.repo-code-lang{padding:4px 7px;border:1px solid #e4e8df;border-radius:99px;color:#7d8377;font:9px var(--pg-sans);white-space:nowrap}
.repo-code-lang[hidden]{display:none}
.tk-k{color:#56773a}.tk-s{color:#93683f}.tk-n{color:#a15d55}.tk-c{color:#9a9f93;font-style:italic}
.tk-f{color:#4a6c90}.tk-p{color:#4f7a73}.tk-v{color:#7a6390}.tk-t{color:#8a7434}
.tk-g{color:#56773a}.tk-a{color:#4f7a73}.tk-m{color:#8b7d62}.tk-h{color:#56773a}
`;
  document.head.append(style);

  const esc = s => s.replace(/[&<>]/g, c => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

  // A token spanning lines is split per line, so the output can be cut into lines with no open
  // tags.
  const span = (type, s) => {
    if (!type) return esc(s);
    const open = '<span class="tk-' + type + '">';
    return (
      open +
      (s.includes('\n')
        ? esc(s)
            .split('\n')
            .join('</span>\n' + open)
        : esc(s)) +
      '</span>'
    );
  };
  const words = s => new Set(s.split(/\s+/).filter(Boolean));

  // ---- Shared rule fragments (sources for one combined regex per language) ----
  const R = {
    lineSlash: '\\/\\/.*',
    block: '\\/\\*[\\s\\S]*?(?:\\*\\/|$(?![\\s\\S]))',
    hashLine: '#.*',
    dq: '"(?:\\\\[\\s\\S]|[^"\\\\\\n])*"?',
    sq: "'(?:\\\\[\\s\\S]|[^'\\\\\\n])*'?",
    bt: '`(?:\\\\[\\s\\S]|[^`\\\\])*`?',
    num: '\\b(?:0[xX][\\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?|\\.\\d[\\d_]*(?:[eE][+-]?\\d+)?)[a-zA-Z]*\\b',
    word: '[A-Za-z_$][\\w$]*',
  };
  const WORD = 'word';

  function compile(lang) {
    const parts = [],
      rules = [];
    let group = 1;
    for (const [type, source] of lang.rules) {
      const inner = new RegExp(source + '|').exec('').length - 1;
      parts.push('(' + source + ')');
      rules.push({ type, group });
      group += 1 + inner;
    }
    lang.re = new RegExp(parts.join('|'), 'gm' + (lang.ciRules ? 'i' : ''));
    lang.list = rules;
    return lang;
  }

  const callAfter = /\s*\(/y;

  function classifyWord(w, text, s, e, lang, st) {
    const k = lang.ci ? w.toLowerCase() : w;
    let type = '';
    if (lang.keywords.has(k)) type = 'k';
    else if (lang.literals?.has(k)) type = 'n';
    else if (lang.types?.has(k)) type = 't';
    else if (st.next) type = st.next;
    else {
      callAfter.lastIndex = e;
      if (callAfter.test(text)) type = 'f';
      else if (text[s - 1] === '.' || (text[s - 1] === '>' && text[s - 2] === '-')) type = 'p';
      else if (lang.caps && /^[A-Z][A-Z0-9_]*[a-z]/.test(w)) type = 't';
      else if (lang.variables?.has(k)) type = 'v';
    }
    st.next = type === 'k' ? lang.decl?.[k] : undefined;
    return type;
  }

  function tokenize(text, lang) {
    const re = lang.re,
      out = [],
      st = {};
    let at = 0,
      m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const s = m.index,
        tok = m[0];
      if (!tok) {
        re.lastIndex++;
        continue;
      }
      if (s > at) {
        const gap = text.slice(at, s);
        if (st.next && /\S/.test(gap)) st.next = undefined;
        out.push(esc(gap));
      }
      let rule = lang.list[0];
      for (const r of lang.list)
        if (m[r.group] !== undefined) {
          rule = r;
          break;
        }
      if (typeof rule.type === 'function') out.push(rule.type(tok, m, rule.group, st, text, s));
      else if (rule.type === WORD)
        out.push(span(classifyWord(tok, text, s, s + tok.length, lang, st), tok));
      else {
        st.next = undefined;
        out.push(span(rule.type, tok));
      }
      at = s + tok.length;
    }
    if (at < text.length) out.push(esc(text.slice(at)));
    return out.join('');
  }

  // ---- Languages ----
  const L = {};
  const def = (id, name, spec) => {
    L[id] = compile(Object.assign({ id, name, keywords: new Set() }, spec));
  };

  const jsKeywords =
    'break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await get set as';
  const jsDecl = {
    let: 'v',
    const: 'v',
    var: 'v',
    function: 'f',
    class: 't',
    extends: 't',
    new: 't',
    interface: 't',
    type: 't',
    enum: 't',
    implements: 't',
  };
  const jsRules = jsx => [
    ['c', R.lineSlash],
    ['c', R.block],
    ['s', R.dq],
    ['s', R.sq],
    ['s', R.bt],
    [
      's',
      '(?<=(?:^|[(,=:\\[!&|?{};]|\\breturn|\\btypeof)\\s*)\\/(?![*/])(?:\\\\.|\\[(?:\\\\.|[^\\]\\\\\\n])*\\]|[^/\\\\\\n\\[])+\\/[dgimsuyv]*',
    ],
    ...(jsx ? [['g', '(?<=(?:^|[(=,:?&|{}>]|\\breturn)\\s*)<\\/?[A-Za-z][\\w.:-]*']] : []),
    ['m', '@[A-Za-z_]\\w*'],
    ['n', R.num],
    [WORD, R.word],
  ];
  const jsBase = {
    keywords: words(jsKeywords),
    literals: words('true false null undefined NaN Infinity'),
    decl: jsDecl,
    caps: true,
    variables: words('arguments globalThis window document console'),
  };
  def('js', 'JavaScript', { ...jsBase, rules: jsRules(false) });
  def('jsx', 'JavaScript JSX', { ...jsBase, rules: jsRules(true) });
  const tsKeywords =
    jsKeywords +
    ' interface type enum implements namespace declare abstract private protected public readonly keyof infer is asserts module override satisfies';
  const tsTypes = words('string number boolean any unknown never void object symbol bigint');
  def('ts', 'TypeScript', {
    ...jsBase,
    keywords: words(tsKeywords),
    types: tsTypes,
    rules: jsRules(false),
  });
  def('tsx', 'TypeScript JSX', {
    ...jsBase,
    keywords: words(tsKeywords),
    types: tsTypes,
    rules: jsRules(true),
  });

  def('json', 'JSON', {
    literals: words('true false null'),
    rules: [
      ['c', R.lineSlash],
      ['c', R.block],
      ['p', '"(?:\\\\.|[^"\\\\\\n])*"(?=\\s*:)'],
      ['s', R.dq],
      ['n', '-?' + R.num],
      [WORD, R.word],
    ],
  });

  const cssRules = scss => [
    ...(scss ? [['c', R.lineSlash]] : []),
    ['c', R.block],
    ['s', R.dq],
    ['s', R.sq],
    ['k', '@[\\w-]+'],
    ['k', '!important\\b'],
    ['v', scss ? '\\$[\\w-]+|--[\\w-]+' : '--[\\w-]+'],
    ['g', '[^{};/@\\s][^{};/@]*?(?=\\s*\\{)'],
    ['p', '(?<=(?:^|[{;])\\s*)[-\\w]+(?=\\s*:(?!:))'],
    ['n', '#[\\da-fA-F]{3,8}\\b'],
    ['n', '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:%|[a-zA-Z]+)?'],
    ['f', '[\\w-]+(?=\\()'],
  ];
  def('css', 'CSS', { rules: cssRules(false) });
  def('scss', 'SCSS', { rules: cssRules(true) });

  def('py', 'Python', {
    keywords: words(
      'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'
    ),
    literals: words('True False None'),
    decl: { def: 'f', class: 't' },
    caps: true,
    variables: words('self cls'),
    rules: [
      ['c', R.hashLine],
      [
        's',
        '[rRbBuUfF]{0,2}(?:"""[\\s\\S]*?(?:"""|$(?![\\s\\S]))|\'\'\'[\\s\\S]*?(?:\'\'\'|$(?![\\s\\S])))',
      ],
      ['s', '[rRbBuUfF]{0,2}(?:' + R.dq + '|' + R.sq + ')'],
      ['m', '^\\s*@[\\w.]+'],
      ['n', R.num],
      [WORD, '[A-Za-z_]\\w*'],
    ],
  });

  const cKeywords =
    'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false';
  const cppKeywords =
    cKeywords +
    ' alignas alignof and asm catch class constexpr const_cast decltype delete dynamic_cast explicit export friend mutable namespace new noexcept not operator or private protected public reinterpret_cast static_assert static_cast template this throw try typeid typename using virtual override final nullptr co_await co_return co_yield concept requires';
  const cRules = extra => [
    ['c', R.lineSlash],
    ['c', R.block],
    ['m', '^\\s*#\\s*\\w+(?:[ \\t]+<[^>\\n]*>)?'],
    ...(extra || []),
    ['s', R.dq],
    ['s', "'(?:\\\\.|[^'\\\\\\n])'"],
    ['n', R.num],
    [WORD, R.word],
  ];
  const cDecl = {
    struct: 't',
    class: 't',
    enum: 't',
    union: 't',
    typename: 't',
    namespace: 't',
    new: 't',
  };
  def('c', 'C', {
    keywords: words(cKeywords),
    literals: words('NULL'),
    types: words('size_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE'),
    decl: cDecl,
    rules: cRules(),
  });
  def('cpp', 'C++', {
    keywords: words(cppKeywords),
    literals: words('NULL'),
    types: words('size_t string vector map set unique_ptr shared_ptr std auto'),
    decl: cDecl,
    caps: true,
    rules: cRules([['s', 'R"\\(([\\s\\S]*?)\\)"']]),
  });
  def('cs', 'C#', {
    keywords: words(
      'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var async await get set init record yield where nameof dynamic partial when'
    ),
    literals: words('true false null'),
    decl: {
      class: 't',
      struct: 't',
      interface: 't',
      enum: 't',
      record: 't',
      new: 't',
      namespace: 't',
    },
    caps: true,
    rules: [
      ['c', R.lineSlash],
      ['c', R.block],
      ['m', '^\\s*#\\w+'],
      ['s', '\\$?@"(?:""|[^"])*"?'],
      ['s', '\\$?' + R.dq],
      ['s', "'(?:\\\\.|[^'\\\\\\n])'"],
      ['m', '\\[[A-Z]\\w*(?=[\\](])'],
      ['n', R.num],
      [WORD, '@?[A-Za-z_]\\w*'],
    ],
  });
  def('java', 'Java', {
    keywords: words(
      'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yield'
    ),
    literals: words('true false null'),
    decl: {
      class: 't',
      interface: 't',
      enum: 't',
      extends: 't',
      implements: 't',
      new: 't',
      record: 't',
    },
    caps: true,
    rules: [
      ['c', R.lineSlash],
      ['c', R.block],
      ['s', '"""[\\s\\S]*?(?:"""|$(?![\\s\\S]))'],
      ['s', R.dq],
      ['s', "'(?:\\\\.|[^'\\\\\\n])'"],
      ['m', '@[A-Za-z_]\\w*'],
      ['n', R.num],
      [WORD, R.word],
    ],
  });
  def('go', 'Go', {
    keywords: words(
      'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var'
    ),
    literals: words('true false nil iota'),
    types: words(
      'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any'
    ),
    decl: { func: 'f', type: 't', var: 'v', const: 'v' },
    caps: true,
    rules: [
      ['c', R.lineSlash],
      ['c', R.block],
      ['s', R.dq],
      ['s', '`[^`]*`?'],
      ['s', "'(?:\\\\.|[^'\\\\\\n])+'"],
      ['n', R.num],
      [WORD, '[A-Za-z_]\\w*'],
    ],
  });
  def('rs', 'Rust', {
    keywords: words(
      'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while'
    ),
    literals: words('true false None Some Ok Err'),
    types: words(
      'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box'
    ),
    decl: { fn: 'f', struct: 't', enum: 't', trait: 't', impl: 't', type: 't', let: 'v', mut: 'v' },
    caps: true,
    rules: [
      ['c', R.lineSlash],
      ['c', R.block],
      ['m', '#!?\\[[^\\]\\n]*\\]'],
      ['s', 'b?r#*"[\\s\\S]*?"#*|b?' + R.dq],
      ['s', "b?'(?:\\\\.|[^'\\\\\\n])'"],
      ['t', "'[a-z_]\\w*(?!')"],
      ['f', '[a-z_]\\w*!(?!=)'],
      ['n', R.num],
      [WORD, '[A-Za-z_]\\w*'],
    ],
  });
  def('rb', 'Ruby', {
    keywords: words(
      'alias and begin break case class def defined? do else elsif end ensure for if in module next not or redo rescue retry return self super then undef unless until when while yield require require_relative attr_accessor attr_reader attr_writer private protected public lambda proc puts'
    ),
    literals: words('true false nil'),
    decl: { def: 'f', class: 't', module: 't' },
    caps: true,
    rules: [
      ['c', '^=begin[\\s\\S]*?(?:^=end|$(?![\\s\\S]))'],
      ['c', R.hashLine],
      ['s', R.dq],
      ['s', R.sq],
      ['n', '(?<![:\\w]):[A-Za-z_]\\w*[?!]?'],
      ['v', '@{1,2}[A-Za-z_]\\w*|\\$[A-Za-z_]\\w*'],
      ['n', R.num],
      [WORD, '[A-Za-z_]\\w*[?!]?'],
    ],
  });
  def('php', 'PHP', {
    ci: true,
    keywords: words(
      'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield'
    ),
    literals: words('true false null'),
    decl: {
      function: 'f',
      class: 't',
      interface: 't',
      trait: 't',
      extends: 't',
      implements: 't',
      new: 't',
      enum: 't',
    },
    caps: true,
    rules: [
      ['m', '<\\?(?:php|=)?|\\?>'],
      ['c', R.lineSlash],
      ['c', R.block],
      ['c', R.hashLine],
      ['v', '\\$[A-Za-z_]\\w*'],
      ['s', R.dq],
      ['s', R.sq],
      ['n', R.num],
      [WORD, '[A-Za-z_]\\w*'],
    ],
  });
  def('sql', 'SQL', {
    ci: true,
    keywords: words(
      'add all alter and any as asc begin between by case cascade check column commit constraint create cross database default delete desc distinct drop else end exists foreign from full group having if in index inner insert into is join key left like limit not null offset on or order outer primary references replace returning right rollback select set table then top transaction trigger truncate union unique update using values view when where with'
    ),
    literals: words('true false'),
    types: words(
      'int integer bigint smallint tinyint decimal numeric float real double char varchar nvarchar text date time timestamp datetime boolean bool blob json jsonb uuid serial'
    ),
    rules: [
      ['c', '--.*'],
      ['c', R.block],
      ['s', "'(?:''|[^'])*'?"],
      ['p', '"(?:""|[^"])*"|`[^`]*`|\\[[^\\]\\n]*\\]'],
      ['v', '[@:][A-Za-z_]\\w*'],
      ['n', R.num],
      [WORD, '[A-Za-z_]\\w*'],
    ],
  });
  def('sh', 'Shell', {
    keywords: words(
      'if then else elif fi case esac for select while until do done in function time return exit break continue local export readonly declare unset shift source alias set trap eval exec'
    ),
    literals: words('true false'),
    variables: new Set(),
    decl: { function: 'f' },
    rules: [
      ['m', '^#!.*'],
      ['c', '(?<![\\w$#{])#.*'],
      ['s', R.dq],
      ['s', "'[^']*'?"],
      ['v', '\\$(?:\\{[^}\\n]*\\}?|[A-Za-z_]\\w*|[\\d#?@*$!-])'],
      ['p', '(?<=\\s)--?[A-Za-z][\\w-]*'],
      ['n', '\\b\\d+\\b'],
      [WORD, '[A-Za-z_][\\w-]*'],
    ],
  });
  def('ps1', 'PowerShell', {
    ci: true,
    ciRules: true,
    keywords: words(
      'begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in param process return static switch throw trap try until using var while workflow'
    ),
    literals: words('$true $false $null'),
    decl: { function: 'f', class: 't', enum: 't', filter: 'f' },
    rules: [
      ['c', '<#[\\s\\S]*?(?:#>|$(?![\\s\\S]))'],
      ['c', R.hashLine],
      ['s', '@"[\\s\\S]*?(?:^"@|$(?![\\s\\S]))|@\'[\\s\\S]*?(?:^\'@|$(?![\\s\\S]))'],
      ['s', R.dq.replace(/\\\\/g, '`')],
      ['s', "'(?:''|[^'])*'?"],
      ['n', '\\$(?:true|false|null)\\b'],
      ['v', '\\$(?:\\{[^}]*\\}|[\\w:]+)'],
      ['t', '\\[[\\w.\\[\\]]+\\]'],
      ['f', '\\b[A-Za-z]+-[A-Za-z]+\\b'],
      ['p', '(?<=\\s)-[A-Za-z]\\w*'],
      ['n', R.num],
      [WORD, '[A-Za-z_]\\w*'],
    ],
  });
  def('bat', 'Batch', {
    ci: true,
    ciRules: true,
    keywords: words(
      'echo set if else goto call exit for in do not exist defined equ neq lss leq gtr geq setlocal endlocal enabledelayedexpansion shift pause start cd pushd popd errorlevel nul cls title'
    ),
    rules: [
      ['c', '^\\s*(?:@?rem\\b.*|::.*)'],
      ['m', '^\\s*@'],
      ['f', '^\\s*:[A-Za-z_][\\w.-]*'],
      ['s', '"[^"\\n]*"?'],
      ['v', '%~?[\\w]*%|%~?[a-z0-9]|![\\w]+!'],
      ['n', '\\b\\d+\\b'],
      [WORD, '[A-Za-z_][\\w]*'],
    ],
  });
  def('yaml', 'YAML', {
    literals: words('true false null yes no on off True False Null ~'),
    rules: [
      ['c', '(?<!\\S)#.*'],
      ['m', '^(?:---|\\.\\.\\.)\\s*$'],
      [
        'p',
        '(?<=^[ \\t]*(?:-[ \\t]+)?)(?:"[^"\\n]*"|\'[^\'\\n]*\'|[^\\s#\'"\\-][^:#\\n]*?)(?=[ \\t]*:(?:\\s|$))',
      ],
      ['s', R.dq],
      ['s', "'(?:''|[^'\\n])*'?"],
      ['v', '[&*][\\w-]+'],
      ['t', '!![\\w]+|!\\w+'],
      ['n', '-?\\b\\d[\\d_.:-]*\\b'],
      ['k', '(?<=^[ \\t]*)-(?=\\s)|[|>][-+]?(?=\\s*$)'],
      [WORD, '[A-Za-z_~][\\w-]*'],
    ],
  });
  def('toml', 'TOML', {
    literals: words('true false inf nan'),
    rules: [
      ['c', R.hashLine],
      ['t', '^\\s*\\[\\[?[^\\]\\n]*\\]\\]?'],
      ['p', '(?<=^\\s*)(?:[\\w.-]+|"[^"\\n]*")(?=\\s*=)'],
      ['s', '"""[\\s\\S]*?(?:"""|$(?![\\s\\S]))|\'\'\'[\\s\\S]*?(?:\'\'\'|$(?![\\s\\S]))'],
      ['s', R.dq],
      ['s', "'[^'\\n]*'?"],
      ['n', '\\d{4}-\\d\\d-\\d\\d(?:[T ][\\d:.]+(?:Z|[+-]\\d\\d:\\d\\d)?)?'],
      ['n', '[+-]?' + R.num],
      [WORD, '[A-Za-z_][\\w-]*'],
    ],
  });

  // Markup (HTML/XML/SVG): a tag scan with attribute handling; <script>/<style> bodies use the
  // JS/CSS rules.
  const attrScan = /\s+|[^\s=>/"']+|=|"[^"]*"?|'[^']*'?|\/?>|\//y;

  function markup(text, html) {
    const out = [],
      re =
        /<!--[\s\S]*?(?:-->|$(?![\s\S]))|<!\[CDATA\[[\s\S]*?(?:\]\]>|$(?![\s\S]))|<[!?][^>]*>?|<\/?[A-Za-z][^\s/>]*|&#?\w+;/g;
    let at = 0,
      m;
    while ((m = re.exec(text))) {
      const tok = m[0];
      out.push(esc(text.slice(at, m.index)));
      at = m.index + tok.length;
      if (tok.startsWith('<!--')) {
        out.push(span('c', tok));
        continue;
      }
      if (tok.startsWith('<![CDATA[')) {
        out.push(span('s', tok));
        continue;
      }
      if (tok[0] === '&') {
        out.push(span('n', tok));
        continue;
      }
      if (tok[1] === '!' || tok[1] === '?') {
        out.push(span('m', tok));
        continue;
      }
      out.push(span('g', tok));

      // Attributes up to the closing '>'.
      let afterEq = false,
        closed = '';
      attrScan.lastIndex = at;
      let a;
      while (at < text.length && (a = attrScan.exec(text))) {
        const part = a[0];
        at = attrScan.lastIndex;
        if (/^\s/.test(part)) out.push(esc(part));
        else if (part === '>' || part === '/>') {
          out.push(span('g', part));
          closed = part;
          break;
        } else if (part === '=') {
          out.push(esc(part));
          afterEq = true;
          continue;
        } else if (part === '/') out.push(span('g', part));
        else out.push(span(afterEq || part[0] === '"' || part[0] === "'" ? 's' : 'a', part));
        afterEq = false;
      }
      re.lastIndex = at;
      const name = tok.slice(1).toLowerCase();
      if (html && closed === '>' && (name === 'script' || name === 'style')) {
        const end = text.toLowerCase().indexOf('</' + name, at),
          stop = end < 0 ? text.length : end;
        out.push(tokenize(text.slice(at, stop), name === 'script' ? L.js : L.css));
        at = re.lastIndex = stop;
      }
    }
    out.push(esc(text.slice(at)));
    return out.join('');
  }
  L.html = { id: 'html', name: 'HTML', render: text => markup(text, true) };
  L.xml = { id: 'xml', name: 'XML', render: text => markup(text, false) };
  L.svg = { id: 'svg', name: 'SVG', render: text => markup(text, false) };

  // Markdown: fenced code blocks are highlighted in their own language when it is known.
  const fence = tok => {
    const nl = tok.indexOf('\n'),
      head = nl < 0 ? tok : tok.slice(0, nl),
      rest = nl < 0 ? '' : tok.slice(nl);
    const close = /\n[ \t]*(?:```|~~~)[ \t]*$/.exec(rest),
      inner = close ? rest.slice(0, close.index) : rest,
      tail = close ? close[0] : '';
    const lang =
      L[
        aliases[
          head
            .replace(/^[\s`~]+/, '')
            .trim()
            .toLowerCase()
        ] || ''
      ];
    return span('m', head) + (lang ? render(inner, lang) : span('s', inner)) + span('m', tail);
  };
  def('md', 'Markdown', {
    rules: [
      [fence, '^[ \\t]*```[^\\n]*(?:\\n[\\s\\S]*?(?:\\n[ \\t]*```[ \\t]*$|$(?![\\s\\S])))?'],
      [fence, '^[ \\t]*~~~[^\\n]*(?:\\n[\\s\\S]*?(?:\\n[ \\t]*~~~[ \\t]*$|$(?![\\s\\S])))?'],
      ['c', '<!--[\\s\\S]*?(?:-->|$(?![\\s\\S]))'],
      ['h', '^#{1,6}[ \\t].*'],
      ['c', '^[ \\t]*>.*'],
      ['k', '^[ \\t]*(?:[-*+]|\\d+[.)])(?=[ \\t])'],
      ['m', '^[ \\t]*(?:-{3,}|\\*{3,}|_{3,})[ \\t]*$'],
      ['s', '`[^`\\n]+`'],
      ['f', '!?\\[[^\\]\\n]*\\](?=[(\\[])'],
      ['p', '(?<=\\])\\([^)\\n]*\\)|(?<=\\])\\[[^\\]\\n]*\\]'],
      ['v', '\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__'],
      ['t', '(?<![*\\w])\\*[^*\\s][^*\\n]*\\*(?!\\*)|(?<!\\w)_[^_\\s][^_\\n]*_(?!\\w)'],
      ['p', '<https?:[^>\\s]+>|https?:\\/\\/[^\\s)>\\]]+'],
    ],
  });

  const aliases = {
    js: 'js',
    mjs: 'js',
    cjs: 'js',
    javascript: 'js',
    jsx: 'jsx',
    ts: 'ts',
    mts: 'ts',
    cts: 'ts',
    typescript: 'ts',
    tsx: 'tsx',
    json: 'json',
    jsonc: 'json',
    json5: 'json',
    webmanifest: 'json',
    html: 'html',
    htm: 'html',
    xhtml: 'html',
    vue: 'html',
    svelte: 'html',
    css: 'css',
    less: 'scss',
    scss: 'scss',
    sass: 'scss',
    md: 'md',
    markdown: 'md',
    mdx: 'md',
    py: 'py',
    pyw: 'py',
    python: 'py',
    ps1: 'ps1',
    psm1: 'ps1',
    psd1: 'ps1',
    powershell: 'ps1',
    pwsh: 'ps1',
    sh: 'sh',
    bash: 'sh',
    zsh: 'sh',
    shell: 'sh',
    console: 'sh',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    xaml: 'xml',
    csproj: 'xml',
    plist: 'xml',
    svg: 'svg',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    cxx: 'cpp',
    hpp: 'cpp',
    hh: 'cpp',
    hxx: 'cpp',
    'c++': 'cpp',
    cs: 'cs',
    csharp: 'cs',
    java: 'java',
    go: 'go',
    rs: 'rs',
    rust: 'rs',
    rb: 'rb',
    ruby: 'rb',
    rake: 'rb',
    gemspec: 'rb',
    php: 'php',
    sql: 'sql',
    bat: 'bat',
    cmd: 'bat',
    batch: 'bat',
  };
  const render = (text, lang) => (lang.render ? lang.render(text) : tokenize(text, lang));

  function languageFor(path) {
    const name = String(path || '')
      .split('/')
      .pop()
      .toLowerCase();
    const ext = name.includes('.') ? name.split('.').pop() : '';
    return L[aliases[ext] || ''] || null;
  }

  // ---- Editor overlay ----
  const api = (window.TnaiCodeHighlight = {
    limit: HIGHLIGHT_LIMIT,
    last: null,
    languageFor: path => languageFor(path)?.name || 'Plain text',
    highlight: (text, path) => {
      const lang = languageFor(path);
      return lang ? render(text, lang) : esc(text);
    },
  });

  const actions = editor.querySelector('.repo-editor-actions');
  const label = document.createElement('span');
  label.className = 'repo-code-lang';
  label.title = 'Syntax colors: language detected from the file extension';
  label.hidden = true;
  actions?.prepend(label);

  const valueProp = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

  function attach(area) {
    const path = area.readOnly
      ? editor.querySelector('.repo-editor-path')?.textContent
      : (area.getAttribute('aria-label') || '').replace(/^Contents of /, '');
    const lang = languageFor(path);
    const wrap = document.createElement('div');
    wrap.className = 'repo-code-wrap' + (area.readOnly ? ' readonly' : '');
    const layer = document.createElement('pre');
    layer.className = 'repo-code-layer';
    layer.setAttribute('aria-hidden', 'true');
    const code = document.createElement('code');
    layer.append(code);
    area.before(wrap);
    wrap.append(layer, area);

    // Only the lines near the viewport are in the DOM, shifted down by their line offset; the whole
    // text is still tokenized so multi-line comments and strings stay right. The line pitch is
    // measured from real layout once.
    let frame = 0,
      timer = 0,
      tokenizeMs = 0,
      lines = null,
      from = 0,
      to = 0,
      pitch = 0;

    function measurePitch() {
      code.textContent = '\n'.repeat(999) + ' ';
      const height = code.getBoundingClientRect().height;
      return height > 0 ? height / 1000 : 0;
    }

    function renderWindow(force) {
      if (!lines) return;
      if (!pitch) {
        pitch = measurePitch();
        force = true;
      }
      const step = pitch || parseFloat(getComputedStyle(area).lineHeight) || 18.6;
      const top = area.scrollTop,
        bottom = top + area.clientHeight;
      const need = [Math.floor(top / step) - MARGIN / 2, Math.ceil(bottom / step) + MARGIN / 2];
      if (force || (need[0] < from && from > 0) || (need[1] > to && to < lines.length)) {
        from = Math.max(0, Math.floor(top / step) - MARGIN);
        to = Math.min(lines.length, Math.ceil(bottom / step) + MARGIN);
        code.innerHTML = lines.slice(from, to).join('\n') + '\n ';
        if (api.last?.path === path) Object.assign(api.last, { range: [from, to], pitch: step });
      }
      code.style.transform = 'translate(' + -area.scrollLeft + 'px,' + (from * step - top) + 'px)';
    }

    function setMode(on, text) {
      wrap.classList.toggle('hl', on);
      label.textContent =
        (lang ? lang.name : 'Plain text') + (lang && !on ? ' · plain (large file)' : '');
      label.hidden = false;
      if (!on) {
        lines = null;
        code.textContent = '';
        api.last = { path, lang: lang?.name || null, chars: text.length, ms: 0, mode: 'plain' };
      }
      return on;
    }

    function full() {
      frame = 0;
      clearTimeout(timer);
      timer = 0;
      const text = valueProp.get.call(area);
      if (!setMode(Boolean(lang) && text.length <= HIGHLIGHT_LIMIT, text)) return;
      const t0 = performance.now();
      lines = render(text, lang).split('\n');
      tokenizeMs = performance.now() - t0;
      api.last = {
        path,
        lang: lang.name,
        chars: text.length,
        ms: Math.round(tokenizeMs * 10) / 10,
        mode: 'color',
      };
      renderWindow(true);
      api.last.paintMs = Math.round((performance.now() - t0) * 10) / 10;
    }

    // Typing: repaint every frame; if tokenizing got slow, show the new text uncolored at once and
    // color it after a pause.
    function quick() {
      frame = 0;
      if (tokenizeMs <= SLOW_MS) return full();
      const text = valueProp.get.call(area);
      if (!setMode(text.length <= HIGHLIGHT_LIMIT, text)) return;
      const t0 = performance.now();
      lines = esc(text).split('\n');
      api.last = { path, lang: lang.name, chars: text.length, ms: 0, mode: 'pending' };
      renderWindow(true);
      api.last.paintMs = Math.round((performance.now() - t0) * 10) / 10;
      clearTimeout(timer);
      timer = setTimeout(full, 200);
    }

    function schedule() {
      if (lang && !frame) frame = requestAnimationFrame(quick);
    }

    // Programmatic changes (Restore edits, drafts) repaint too.
    Object.defineProperty(area, 'value', {
      configurable: true,
      get() {
        return valueProp.get.call(this);
      },
      set(v) {
        valueProp.set.call(this, v);
        schedule();
      },
    });
    area.addEventListener('input', schedule);
    area.addEventListener('scroll', () => renderWindow(false), { passive: true });
    full();
  }

  function scan() {
    const area = body.querySelector('.repo-editor-text');
    if (!area) {
      label.hidden = true;
      return;
    }
    if (!area.parentElement.classList.contains('repo-code-wrap')) attach(area);
  }
  new MutationObserver(scan).observe(body, { childList: true });
  scan();
})();
