import { supabase } from './supabase';

export interface AccessRequest {
  id: string;
  contactId: string;
  ownerId: string;
  requesterId: string;
  spaceId: string | null;
  status: 'pending' | 'approved' | 'denied';
  reason: string | null;
  createdAt: string;
  respondedAt: string | null;
  // Present when the row was fetched with the contact/requester joined in.
  contactName?: string;
  requesterName?: string;
}

/** Ask the owner of a locked contact for full access to it. */
export async function requestContactAccess(
  contactId: string,
  requesterId: string,
  spaceId: string | null,
  ownerId: string,
  reason?: string
): Promise<void> {
  const { error } = await supabase.from('contact_access_requests').insert({
    contact_id: contactId,
    owner_id: ownerId,
    requester_id: requesterId,
    space_id: spaceId,
    reason: reason || null
  });
  // A duplicate request (unique constraint on contact_id+requester_id) isn't
  // a real error from the user's point of view — they already asked.
  if (error && error.code !== '23505') throw error;
}

/** Requests I've sent that are still pending (so the UI can show "en attente"). */
export async function listMyPendingRequests(requesterId: string): Promise<AccessRequest[]> {
  const { data, error } = await supabase
    .from('contact_access_requests')
    .select('id, contact_id, owner_id, requester_id, space_id, status, reason, created_at, responded_at')
    .eq('requester_id', requesterId)
    .eq('status', 'pending');

  if (error) {
    console.error('listMyPendingRequests failure:', error);
    return [];
  }

  return (data || []).map(mapRow);
}

/** Incoming requests for contacts I own, so I can approve/deny them. */
export async function listIncomingRequests(ownerId: string): Promise<AccessRequest[]> {
  const { data, error } = await supabase
    .from('contact_access_requests')
    .select('id, contact_id, owner_id, requester_id, space_id, status, reason, created_at, responded_at, contact:contacts(first_name, last_name)')
    .eq('owner_id', ownerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('listIncomingRequests failure:', error);
    return [];
  }

  return (data || []).map((row: any) => ({
    ...mapRow(row),
    contactName: row.contact ? `${row.contact.first_name} ${row.contact.last_name}` : undefined
  }));
}

export async function respondToAccessRequest(requestId: string, approve: boolean): Promise<void> {
  const { error } = await supabase
    .from('contact_access_requests')
    .update({ status: approve ? 'approved' : 'denied', responded_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) throw error;
}

function mapRow(row: any): AccessRequest {
  return {
    id: row.id,
    contactId: row.contact_id,
    ownerId: row.owner_id,
    requesterId: row.requester_id,
    spaceId: row.space_id,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
    respondedAt: row.responded_at
  };
}
