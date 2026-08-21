import {
  applyOccurrenceTranslation,
  collectPageOccurrences,
  deduplicateOccurrences,
  restoreOccurrence,
} from './domPipeline';

const collect = () =>
  collectPageOccurrences(document.documentElement, {
    sourceLanguage: 'en',
    targetLanguage: 'de',
    identity: { provider: 'openai', model: 'small-model' },
    excludeSelectors: ['code', 'pre'],
  });

describe('DOM page translation pipeline', () => {
  beforeEach(() => {
    document.title = 'Settings';
    document.body.innerHTML = '';
  });

  test('reconstructs one inline sentence and preserves inline node identity', () => {
    document.body.innerHTML =
      '<main><p>Click <strong>Save</strong> to continue.</p></main>';
    const strong = document.querySelector('strong');
    const page = collect();
    const units = deduplicateOccurrences(page.occurrences);

    expect(units).toHaveLength(1);
    expect(units[0].sourceText).toBe('Click <g id="g-1">Save</g> to continue.');

    applyOccurrenceTranslation(
      units[0].occurrences[0],
      'Klicken Sie zum Fortfahren auf <g id="g-1">Speichern</g>.',
    );
    expect(document.querySelector('strong')).toBe(strong);
    expect(strong?.textContent).toBe('Speichern');
    expect(document.querySelector('p')?.textContent).toBe(
      'Klicken Sie zum Fortfahren auf Speichern.',
    );

    restoreOccurrence(units[0].occurrences[0]);
    expect(document.querySelector('strong')).toBe(strong);
    expect(document.querySelector('p')?.textContent).toBe('Click Save to continue.');
  });

  test('sends pure text for structural wrappers and skips placeholder-only segments', () => {
    document.body.innerHTML =
      '<main><a><span>FAQ</span><input></a><a><span>Noctalia</span><span>Current release · v5+</span></a><button><input></button></main>';
    const spans = Array.from(document.querySelectorAll('span'));
    const input = document.querySelector('a input');
    const units = deduplicateOccurrences(collect().occurrences);

    expect(units.map((unit) => unit.sourceText)).toEqual([
      'FAQ',
      'Noctalia',
      'Current release · v5+',
    ]);

    applyOccurrenceTranslation(units[0].occurrences[0], 'Häufige Fragen');
    expect(Array.from(document.querySelectorAll('span'))).toEqual(spans);
    expect(document.querySelector('a input')).toBe(input);
    expect(spans[0].textContent).toBe('Häufige Fragen');
  });

  test('protects inline code and restores it unchanged', () => {
    document.body.innerHTML = '<p>Run <code>npm test</code> now.</p>';
    const unit = deduplicateOccurrences(collect().occurrences)[0];
    expect(unit.sourceText).toBe('Run <x id="x-1"/> now.');
    const code = document.querySelector('code');

    applyOccurrenceTranslation(
      unit.occurrences[0],
      'Führen Sie jetzt <x id="x-1"/> aus.',
    );
    expect(document.querySelector('code')).toBe(code);
    expect(code?.textContent).toBe('npm test');
  });

  test('skips filesystem paths that have no translatable text', () => {
    document.body.innerHTML =
      '<main><p>/etc/sv/wpa_supplicant/conf</p><p>/etc/dbus-1/<code>system.d</code>/<code>wpa_supplicant.conf</code></p></main>';

    expect(collect().occurrences).toHaveLength(0);
  });

  test('deduplicates equivalent buttons but not semantically different text', () => {
    document.body.innerHTML = `
      <main>
        <button>Save</button><button>Save</button>
        <button>Open</button><div role="status">Open</div>
        <nav><a>Home</a></nav><h1>Home</h1>
      </main>`;
    const units = deduplicateOccurrences(collect().occurrences);
    const save = units.filter((unit) => unit.normalizedText === 'Save');
    const open = units.filter((unit) => unit.normalizedText === 'Open');
    const home = units.filter((unit) => unit.normalizedText === 'Home');

    expect(save).toHaveLength(1);
    expect(save[0].occurrences).toHaveLength(2);
    expect(open.map((unit) => unit.kind).sort()).toEqual(['button', 'status']);
    expect(home.map((unit) => unit.kind).sort()).toEqual(['heading', 'navigation-item']);
  });

  test('extracts label text and input placeholder as independent slots', () => {
    document.body.innerHTML = '<label>Username <input placeholder="Username"></label>';
    const occurrences = collect().occurrences;
    expect(
      occurrences.map(({ normalizedText, kind, slot }) => ({
        normalizedText,
        kind,
        slot,
      })),
    ).toEqual([
      {
        normalizedText: 'Username <x id="x-1"/>',
        kind: 'form-label',
        slot: 'visible-text',
      },
      { normalizedText: 'Username', kind: 'placeholder', slot: 'placeholder' },
    ]);
  });
});
