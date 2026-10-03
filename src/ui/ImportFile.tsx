import React, { useMemo, useState } from 'react';
import { FileUp } from 'lucide-react';
import { useData } from '../data';
import { supabase } from '../lib/supabase';
import { IS_MOCK } from '../lib/mode';
import { cn } from '../lib/utils';
import { circleColor } from './format';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { parseCsv, guessMapping, buildContacts, FIELD_LABEL, type Field } from '../lib/importFile';

// Import d'un fichier CSV ou Excel : correspondance des colonnes, aperçu,
// import par lots, bilan. Les personnes déjà présentes dans vos cercles sont
// ignorées par la base (trigger zz_skip_duplicate_import, source 'import').

const MAX_ROWS = 20000;
const BATCH = 500;
type Summary = { created: number; already: number; duplicatesInFile: number; withoutName: number; errors: string[] };

export const ImportFile: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const data = useData();
  const personal = data.spaces.find((s) => s.type === 'personal');
  const [spaceId, setSpaceId] = useState<string>(data.selectedSpaceId ?? personal?.id ?? data.spaces[0]?.id ?? '');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<(Field | null)[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const read = async (file: File) => {
    setError(null);
    try {
      let table: string[][];
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await file.arrayBuffer());
        const sheet = wb.Sheets[wb.SheetNames[0]];
        table = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as unknown[][])
          .map((r) => r.map((c) => String(c ?? ''))).filter((r) => r.some((c) => c.trim()));
      } else {
        table = parseCsv(await file.text());
      }
      if (table.length < 2) { setError("Ce fichier ne contient pas de ligne de contact sous l'en-tête."); return; }
      if (table.length - 1 > MAX_ROWS) { setError(`Ce fichier contient ${(table.length - 1).toLocaleString('fr-FR')} lignes. Découpez-le en fichiers de ${MAX_ROWS.toLocaleString('fr-FR')} lignes au plus.`); return; }
      setFileName(file.name);
      setRows(table);
      setMapping(guessMapping(table[0]));
    } catch {
      setError("Ce fichier n'a pas pu être lu. Enregistrez-le au format CSV ou Excel (.xlsx), puis réessayez.");
    }
  };

  const built = useMemo(() => (rows ? buildContacts(rows.slice(1), mapping) : null), [rows, mapping]);
  const hasName = mapping.some((f) => f === 'first_name' || f === 'last_name' || f === 'full_name');

  const run = async () => {
    if (!built || !spaceId) return;
    if (!hasName) { setError('Indiquez au moins la colonne du prénom, du nom ou du nom complet.'); return; }
    const payload = built.contacts.map((c) => ({ ...c, space_id: spaceId, owner_id: data.user?.id, source: 'import' }));
    let created = 0;
    const errors: string[] = [];
    if (!IS_MOCK) {
      for (let i = 0; i < payload.length; i += BATCH) {
        setProgress(`Import… ${Math.min(i + BATCH, payload.length).toLocaleString('fr-FR')} / ${payload.length.toLocaleString('fr-FR')}`);
        const chunk = payload.slice(i, i + BATCH);
        const { data: ins, error: e } = await supabase.from('contacts').insert(chunk).select('id');
        if (!e) { created += ins?.length ?? 0; continue; }
        // Un lot refusé (conflit d'unicité, valeur invalide) : ligne par ligne pour sauver le reste.
        for (const row of chunk) {
          const { data: one, error: e1 } = await supabase.from('contacts').insert(row).select('id');
          if (!e1) created += one?.length ?? 0;
          else if (e1.code !== '23505') errors.push(`${row.first_name} ${row.last_name ?? ''} : ${e1.message}`);
        }
      }
      await data.refresh();
    } else {
      created = payload.length;
    }
    setProgress(null);
    setSummary({ created, already: payload.length - created - errors.length, duplicatesInFile: built.duplicatesInFile, withoutName: built.withoutName, errors });
  };

  if (summary) {
    return (
      <>
        <div className="flex flex-col gap-3 text-sm">
          <p className="font-medium">{summary.created.toLocaleString('fr-FR')} contact{summary.created > 1 ? 's' : ''} importé{summary.created > 1 ? 's' : ''}.</p>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-[13px] tabular-nums">
            <dt className="text-muted-foreground">Déjà présents dans vos cercles, ignorés</dt><dd>{summary.already.toLocaleString('fr-FR')}</dd>
            <dt className="text-muted-foreground">En double dans le fichier</dt><dd>{summary.duplicatesInFile.toLocaleString('fr-FR')}</dd>
            <dt className="text-muted-foreground">Lignes sans nom</dt><dd>{summary.withoutName.toLocaleString('fr-FR')}</dd>
            <dt className="text-muted-foreground">Erreurs</dt><dd>{summary.errors.length.toLocaleString('fr-FR')}</dd>
          </dl>
          {summary.errors.length > 0 && (
            <ul className="max-h-32 overflow-y-auto rounded-md border p-2 text-xs text-muted-foreground">
              {summary.errors.slice(0, 50).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
        <DialogFooter><Button onClick={onClose}>Terminer</Button></DialogFooter>
      </>
    );
  }

  if (!rows) {
    return (
      <>
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) read(f); }}
          className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors focus-within:border-foreground/40',
            dragOver ? 'border-foreground/40 bg-muted' : 'hover:bg-muted/60')}>
          <FileUp className="size-5 text-muted-foreground" />
          <span className="text-sm font-medium">Choisir un fichier CSV ou Excel</span>
          <span className="text-xs text-muted-foreground">Ou déposez-le ici. Une ligne par contact, les noms de colonnes sur la première ligne.</span>
          <input type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
        </label>
        {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" onClick={onClose}>Annuler</Button></DialogFooter>
      </>
    );
  }

  const header = rows[0];
  const sample = (i: number) => rows.slice(1, 6).map((r) => r[i]).find((v) => v && v.trim()) ?? '';
  return (
    <>
      <p className="text-sm text-muted-foreground">
        {fileName} · {(rows.length - 1).toLocaleString('fr-FR')} ligne{rows.length > 2 ? 's' : ''}. Vérifiez à quel champ correspond chaque colonne.
      </p>
      <div className="-mx-1 max-h-[42vh] overflow-y-auto px-1">
        <table className="w-full table-fixed text-[13px]">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="w-[34%] pb-1.5 font-medium">Colonne du fichier</th><th className="pb-1.5 font-medium">Exemple</th><th className="w-[34%] pb-1.5 font-medium">Champ Circl</th></tr></thead>
          <tbody className="divide-y">
            {header.map((h, i) => (
              <tr key={i}>
                <td className="truncate py-1.5 pr-2 font-medium">{h || `Colonne ${i + 1}`}</td>
                <td className="truncate py-1.5 pr-2 text-muted-foreground">{sample(i) || '—'}</td>
                <td className="py-1.5">
                  <select value={mapping[i] ?? ''} aria-label={`Champ pour la colonne ${h || i + 1}`}
                    onChange={(e) => { const v = (e.target.value || null) as Field | null; setMapping((m) => m.map((x, j) => (j === i ? v : x === v && v ? null : x))); setError(null); }}
                    className="h-8 w-full rounded-md border bg-card px-2 text-[13px]">
                    <option value="">Ignorer</option>
                    {(Object.keys(FIELD_LABEL) as Field[]).map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Dans le cercle</span>
        {data.spaces.map((s) => (
          <Button key={s.id} variant={spaceId === s.id ? 'secondary' : 'ghost'} size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setSpaceId(s.id)}>
            <span className="size-1.5 rounded-full" style={{ background: circleColor(s) }} />{s.name}
          </Button>
        ))}
      </div>
      {built && (
        <p className="text-[13px] tabular-nums text-muted-foreground">
          {built.contacts.length.toLocaleString('fr-FR')} fiche{built.contacts.length > 1 ? 's' : ''} prête{built.contacts.length > 1 ? 's' : ''}
          {built.duplicatesInFile > 0 && ` · ${built.duplicatesInFile} en double dans le fichier`}
          {built.withoutName > 0 && ` · ${built.withoutName} sans nom`}. Les personnes déjà présentes dans vos cercles seront ignorées.
        </p>
      )}
      {error && <p role="alert" className="text-[13px] text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={() => { setRows(null); setError(null); }} disabled={!!progress}>Autre fichier</Button>
        <Button onClick={run} disabled={!!progress || !built?.contacts.length || !spaceId}>
          {progress ?? `Importer ${built?.contacts.length.toLocaleString('fr-FR') ?? ''}`}
        </Button>
      </DialogFooter>
    </>
  );
};
