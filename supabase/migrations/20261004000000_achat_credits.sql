-- Achat de crédits d'enrichissement (Stripe Checkout, paiement unique).
-- Le webhook crédite le solde une seule fois par session Stripe : la
-- référence de session est unique dans le journal des crédits.
alter table public.credit_ledger add column if not exists ref text;
create unique index if not exists credit_ledger_ref_uniq on public.credit_ledger (ref) where ref is not null;

create or replace function public.add_enrichment_credits(p_user uuid, p_credits int, p_reason text, p_ref text)
returns int language plpgsql security definer set search_path = public as $$
declare v_balance int; v_inserted int;
begin
  if p_credits <= 0 then raise exception 'Montant invalide'; end if;
  insert into credit_ledger (user_id, delta, reason, ref) values (p_user, p_credits, p_reason, p_ref)
    on conflict (ref) where ref is not null do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    select balance into v_balance from enrichment_credits where user_id = p_user;
    return coalesce(v_balance, 25); -- déjà crédité : rien ne change
  end if;
  insert into enrichment_credits (user_id, balance) values (p_user, 25 + p_credits)
    on conflict (user_id) do update set balance = enrichment_credits.balance + p_credits, updated_at = now()
    returning balance into v_balance;
  return v_balance;
end $$;
revoke execute on function public.add_enrichment_credits(uuid, int, text, text) from public, anon, authenticated;
