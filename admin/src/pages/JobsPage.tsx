import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { ServiceJobCard } from '../lib/types'
import { EmptyState, PageHeader, Spinner } from '../components/ui'
import { Modal } from '../components/Modal'
import AssignToJobModal from '../components/AssignToJobModal'
import NewJobModal from '../components/NewJobModal'
import { dateTime } from '../lib/format'

/**
 * Workshop / dispatch page ("Service Jobs").
 *
 * Lists every service job card. A manager opens the "Assign" button on a row
 * to dispatch that job to a registered employee — that opens
 * <AssignToJobModal>, which calls api.assignJob(...) and posts to
 * /api/admin/jobs/:id/assign on the server.
 */
export default function JobsPage() {
  const [jobs, setJobs] = useState<ServiceJobCard[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedJob, setSelectedJob] = useState<ServiceJobCard | null>(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { jobs: list } = await api.jobs()
      setJobs(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load jobs')
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const refresh = useCallback(() => load(), [load])

  const statusPill = (s: ServiceJobCard['status']) => {
    const map: Record<string, string> = {
      pending: 'bg-amber-500/15 text-amber-300 border-amber-500/20',
      in_progress: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
      completed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
      cancelled: 'bg-red-500/15 text-red-300 border-red-500/20',
    }
    return (
      'inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium capitalize ' +
      (map[s] || map.pending)
    )
  }
  const priorityPill = (p: ServiceJobCard['priority']) => {
    const map: Record<string, string> = {
      low: 'text-slate-400',
      normal: 'text-slate-300',
      high: 'text-amber-300',
      urgent: 'text-red-300',
    }
    return map[p] || map.normal
  }

  return (
    <div>
      <PageHeader
        title="Service Jobs"
        subtitle="Workshop job cards — create one, then assign it to a registered employee to dispatch the work."
        actions={<button className="btn-primary" onClick={() => setShowNew(true)}>New job card</button>}
      />

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {loading ? (
        <Spinner />
      ) : !jobs ? (
        <Spinner />
      ) : jobs.length === 0 ? (
        <EmptyState message="No job cards yet. Create one above to dispatch work to the workshop." />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="th text-left">Issue</th>
                <th className="th text-right">Mileage (km)</th>
                <th className="th text-left">Priority</th>
                <th className="th text-left">Status</th>
                <th className="th text-left">Assigned to</th>
                <th className="th text-left">Created</th>
                <th className="th text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-slate-800/60">
                  <td className="td">
                    <span className="text-sm text-white">{j.issue}</span>
                  </td>
                  <td className="td text-right">{j.mileage_km}</td>
                  <td className="td">
                    <span className={priorityPill(j.priority)}>{j.priority}</span>
                  </td>
                  <td className="td">
                    <span className={statusPill(j.status)}>{j.status}</span>
                  </td>
                  <td className="td text-sm">{j.assigned_to_name || '—'}</td>
                  <td className="td text-sm text-slate-400">{dateTime(j.created_at)}</td>
                  <td className="td text-center">
                    <button className="btn-ghost text-xs" onClick={() => setSelectedJob(j)}>
                      Assign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <NewJobModal onClose={() => setShowNew(false)} onCreated={refresh} />}
      {selectedJob && (
        <AssignToJobModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onAssigned={refresh}
        />
      )}
    </div>
  )
}
