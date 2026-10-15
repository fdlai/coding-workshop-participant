import { useState } from 'react';
import useFetch from '../../hooks/useFetch';
import { auditApi, usersApi } from '../../services/endpoints';
import { Async, EmptyState } from '../../components/ui/Feedback';
import { Avatar, PageHeader } from '../../components/ui/Display';
import { Button, DataTable, FilterBar, Pagination, SelectInput, TextInput } from '../../components/ui/Controls';
import { formatDateTime, fullName } from '../../utils/format';

const PAGE_SIZE = 25;

/** Admin audit-log viewer with action / entity / actor / date filters. */
export default function AuditPage() {
  const [filters, setFilters] = useState({ action: '', entity_type: '', actor_id: '', since: '', until: '' });
  const [offset, setOffset] = useState(0);
  const set = (key) => (e) => { setFilters((f) => ({ ...f, [key]: e.target.value })); setOffset(0); };
  const actors = useFetch(() => usersApi.list({}));
  const logs = useFetch(() => auditApi.list({ ...filters, limit: PAGE_SIZE, offset }), [JSON.stringify(filters), offset]);
  // Filters stay outside <Async> so a failed request (e.g. a bad date range) can still be corrected.
  // Their options come from the last page that loaded, which useFetch keeps after an error.
  const options = logs.data || { available_actions: [], available_entity_types: [] };

  return (
    <>
      <PageHeader title="Audit Logs" subtitle="Every administrative change, newest first" />
      <FilterBar>
        <div className="w-44">
          <SelectInput aria-label="Action" value={filters.action} onChange={set('action')}>
            <option value="">All actions</option>
            {options.available_actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </SelectInput>
        </div>
        <div className="w-44">
          <SelectInput aria-label="Entity type" value={filters.entity_type} onChange={set('entity_type')}>
            <option value="">All entities</option>
            {options.available_entity_types.map((a) => <option key={a} value={a}>{a}</option>)}
          </SelectInput>
        </div>
        <div className="w-44">
          <SelectInput aria-label="Actor" value={filters.actor_id} onChange={set('actor_id')}>
            <option value="">All actors</option>
            {(actors.data || []).map((a) => <option key={a.id} value={a.id}>{fullName(a)}</option>)}
          </SelectInput>
        </div>
        <div className="w-40"><TextInput type="date" aria-label="From date" value={filters.since} onChange={set('since')} /></div>
        <div className="w-40"><TextInput type="date" aria-label="To date" value={filters.until} onChange={set('until')} /></div>
        <Button variant="secondary" onClick={() => { setFilters({ action: '', entity_type: '', actor_id: '', since: '', until: '' }); setOffset(0); }}>Clear</Button>
      </FilterBar>
      <Async state={logs}>
        {(page) => (
          <>
            {page.items.length === 0 ? (
              <EmptyState title="No audit entries match" />
            ) : (
              <>
                <DataTable
                  rows={page.items}
                  columns={[
                    { key: 'created_at', header: 'When', render: (e) => formatDateTime(e.created_at) },
                    { key: 'actor', header: 'Actor', render: (e) => <span className="flex items-center gap-2"><Avatar person={e.actor} size="sm" />{fullName(e.actor)}</span> },
                    { key: 'action', header: 'Action' },
                    { key: 'entity', header: 'Entity', render: (e) => `${e.entity_type}${e.entity_id ? ` #${e.entity_id}` : ''}` },
                    { key: 'description', header: 'Description' },
                  ]}
                />
                <Pagination offset={page.offset} limit={page.limit} total={page.total} onChange={setOffset} />
              </>
            )}
          </>
        )}
      </Async>
    </>
  );
}
