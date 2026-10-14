# Code style

How code in Technically Not is laid out, for people and for AI agents. Every code file was brought to this style on 2026-10-10 (`tools/format-code.js`), so that the code is easy to read by hand.

## The short version

After you edit a code file, run:

```
node tools/format-code.js path/to/file.js
```

It formats the file and proves the program did not change. To see every file that is not formatted: `npm run format:check`. To format everything: `npm run format`.

## What the formatter does

1. Runs Prettier with the settings in `.prettierrc.json`: lines up to 100 characters, single quotes, two spaces, one statement per line.
2. Moves a comment that made its line too long onto its own lines above the code it explains.
3. Wraps long comments, and writes long block comments with a star at the start of each line.
4. Puts a blank line before a comment block and before a function or class.
5. Before it writes a file, it compares the parser's tree of the old and the new text and checks that every comment word is still there. If either differs, the file is left as it was and named in the output.

## What it does not touch

`.prettierignore` lists them: `index.html` and the other pages (markup where white space between elements can change the look), `docs/`, vendored and minified files, `package-lock.json`, the bench records.

## What the formatter cannot do for you

- **Say what the file is for.** Start each file with a comment of one or two lines: the feature, and what the file owns.
- **A file's first comment with a list in it is written as `//` lines.** A block comment (`/* … */`) whose lines are indented to form a list or a table is re-wrapped by the formatter on a later run and comes out with doubled stars and the list run together (seen 2026-10-11 in `desktop/thread-log.js`). Lines that start with `//` and list items that start with `// - ` are left as written.
- **Keep a comment next to its code.** Write a comment on its own line above the code it explains, not behind the code and not after a closing `}` or `)`. A note inside a list goes above the item it is about.
- **Explain why, not what.** A comment says why the code is the way it is, or what would break without it.
- **The reason is the code's, not the owner's.** The code is public: a comment never quotes the owner, names them, or calls the code the owner's decision with a date. Write the reason itself ("so nothing changes while the user looks at it"); the decision and its date live in the docs. The public copy's check fails on each such comment (learned that way: seven agents wrote them in one day).
- **Use names that read.** A one-letter name is fine in a three-line callback; in a longer function, spell the name out. Much of the older code uses short names; give new code full ones, and do not rename old code as part of another change.
- **Keep functions and files small.** A new function over about 150 lines or a new file over about 1,500 lines should be split. The existing large ones are split only while someone works on them (`tnai-code-organization` skill).

## Tests that read source text

Some tests look for a piece of text in a source file. Write such a check so that it does not depend on line breaks or spacing (match with `\s*` between the parts, or take the white space out of both sides first); otherwise the formatter breaks the test without changing the program.
