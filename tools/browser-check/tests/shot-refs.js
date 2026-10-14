// @N attachment references (27 TnaiShotRefs): "@1 … @2 …" puts each instruction under its
// attachment on send; removing a chip renumbers @N. Run: .\tools\browser-check\check.ps1 -Test
// shot-refs
(async () => {
  const { log, wait } = check;
  try {
    await wait(300);
    const R = window.TnaiShotRefs,
      eq = (name, got, want) =>
        log(
          name + ':',
          got === want
            ? 'PASS'
            : 'FAIL\n  got:  ' + JSON.stringify(got) + '\n  want: ' + JSON.stringify(want)
        );
    const shots = [
      { n: 1, ref: '[Attached image: C:\\a\\one.png]', image: true },
      { n: 2, ref: '[Attached image: C:\\a\\two.png]', image: true },
      { n: 3, ref: '[Attached file: src/app.js]', image: false },
    ];
    eq('no @N: unchanged path', R.organize('make it nicer', shots, ''), null);
    eq('unknown @N stays literal', R.organize('fix @7 please', shots, ''), null);
    eq(
      'email/decimal not refs',
      R.tokens('a@1.com x@2 @1.5 (@2) @3.')
        .map(t => t.n)
        .join(','),
      '2,3'
    );
    eq(
      'organized',
      R.organize(
        'Keep the brand colors. @1: make the header blue @2 - remove the footer @9 too',
        shots,
        ' [Mentioned file: src/x.js]'
      ),
      'Keep the brand colors. [Attached file: src/app.js] [Mentioned file: src/x.js]\n\nScreenshot 1 — [Attached image: C:\\a\\one.png]\nmake the header blue\n\nScreenshot 2 — [Attached image: C:\\a\\two.png]\nremove the footer @9 too'
    );
    eq(
      'only @N, repeats merge, empty section',
      R.organize('@2 first @1 @2 second', shots.slice(0, 2), ''),
      'Screenshot 1 — [Attached image: C:\\a\\one.png]\n(no specific instructions)\n\nScreenshot 2 — [Attached image: C:\\a\\two.png]\nfirst\nsecond'
    );
    eq(
      'pasted content not parsed',
      R.organize('see <pasted_text n="1">x @1 y</pasted_text>', shots, ''),
      null
    );
    eq(
      'renumber after removing #2',
      R.renumber('@1 a @2 b @3 c', 2),
      '@1 a (removed attachment) b @2 c'
    );
  } catch (e) {
    log('ERROR', e.message);
  }
  check.done();
})();
