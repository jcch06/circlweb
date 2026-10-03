-- Suivi LinkedIn : un interrupteur par fiche, en plus des tags « VIP » et
-- « À suivre ». Le cron quotidien (notify-digest) appelle track-linkedin.
alter table public.contacts add column if not exists follow_linkedin boolean not null default false;

drop function if exists public.get_trackable_contacts(int);
create function public.get_trackable_contacts(p_limit int)
returns table(id uuid, first_name text, last_name text, company text, job_title text, industry text, location text, linkedin text, space_id uuid)
language sql stable set search_path = public as $$
    select c.id, c.first_name, c.last_name, c.company, c.job_title,
           c.industry, c.location, c.linkedin, c.space_id
    from public.contacts c
    where c.linkedin is not null
      and (c.follow_linkedin or exists (
        select 1 from public.contact_tags ct
        join public.tags t on t.id = ct.tag_id
        where ct.contact_id = c.id
          and lower(t.name) in ('vip', 'à suivre', 'a suivre')
      ))
      and (c.tracked_at is null or c.tracked_at < now() - interval '6 days')
    order by c.tracked_at asc nulls first
    limit greatest(1, least(p_limit, 50));
$$;
revoke execute on function public.get_trackable_contacts(int) from public, anon, authenticated;
