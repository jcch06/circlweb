import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { IS_MOCK } from '../lib/mode';
import { relativeFR } from './format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

// Gmail et Agenda : connexion, synchronisation à la demande, déconnexion.
type Conn = { google_email: string | null; last_sync_at: string | null; last_error: string | null };

export const GoogleConnect: React.FC<{ onClose: () => void; onSynced?: () => void }> = ({ onClose, onSynced }) => {
  const [conn, setConn] = useState<Conn | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    if (IS_MOCK) { setConn(null); return; }
    const { data } = await supabase.from('google_connections').select('google_email, last_sync_at, last_error').maybeSingle();
    setConn((data as Conn) ?? null);
  };
  useEffect(() => { load(); }, []);

  const call = async (fn: string, body: object) => {
    const res: any = await supabase.functions.invoke(fn, { body });
    if (!res.error) return res.data;
    let msg = 'Une erreur est survenue. Réessayez dans un instant.';
    try { const b = await res.error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* corps illisible */ }
    throw new Error(msg);
  };
  const connect = async () => {
    if (IS_MOCK) { setMessage("La connexion Google n'est pas disponible en mode démonstration."); return; }
    setBusy('connect'); setMessage(null);
    try { const d = await call('google-oauth', { action: 'start' }); window.location.href = d.url; }
    catch (e: any) { setBusy(null); setMessage(e.message); }
  };
  const sync = async () => {
    setBusy('sync'); setMessage(null);
    try {
      const d = await call('google-sync', {});
      setMessage(`${d.interactions ?? 0} échange${(d.interactions ?? 0) > 1 ? 's' : ''} rattaché${(d.interactions ?? 0) > 1 ? 's' : ''} à vos contacts.`);
      await load(); onSynced?.();
    } catch (e: any) { setMessage(e.message); }
    setBusy(null);
  };
  const disconnect = async () => {
    setBusy('disconnect');
    const { error } = await supabase.from('google_connections').delete().not('user_id', 'is', null);
    setBusy(null);
    if (error) { setMessage(`Déconnexion impossible : ${error.message}`); return; }
    setConn(null); setMessage('Google est déconnecté. Le jeton a été supprimé.');
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Gmail et Google Agenda</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3 text-sm">
          <p className="leading-relaxed text-muted-foreground">
            Circl repère vos échanges avec vos contacts : qui vous a écrit, à qui vous avez écrit, qui était à vos rendez-vous. Il met à jour le dernier échange de chaque fiche, sans saisie.
          </p>
          <p className="leading-relaxed text-muted-foreground">
            Circl ne lit jamais le contenu de vos emails : seulement l'expéditeur, les destinataires et la date. Ces échanges ne sont visibles que par vous.
          </p>
          {conn === undefined ? null : conn ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-muted-foreground">Compte</dt><dd className="truncate">{conn.google_email ?? 'Compte Google'}</dd>
              <dt className="text-muted-foreground">Dernière synchronisation</dt><dd>{conn.last_sync_at ? relativeFR(conn.last_sync_at) : 'pas encore'}</dd>
            </dl>
          ) : null}
          {conn?.last_error && <p role="alert" className="text-[13px] text-destructive">{conn.last_error}</p>}
          {message && <p role="status" className="text-[13px]">{message}</p>}
        </div>
        <DialogFooter>
          {conn ? (
            <>
              <Button variant="ghost" onClick={disconnect} disabled={!!busy}>Déconnecter</Button>
              {conn.last_error && <Button variant="outline" onClick={connect} disabled={!!busy}>Reconnecter</Button>}
              <Button onClick={sync} disabled={!!busy}>{busy === 'sync' ? 'Synchronisation…' : 'Synchroniser maintenant'}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>Plus tard</Button>
              <Button onClick={connect} disabled={!!busy || conn === undefined}>{busy === 'connect' ? 'Redirection…' : 'Connecter Google'}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
