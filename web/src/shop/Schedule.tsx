// Shop schedule: Bryntum Gantt, one summary row per machine, jobs as bars.
import { useEffect, useRef } from 'react'
import { Gantt } from '@bryntum/gantt'
import type { Job, Machine } from '../../../shared/types.ts'

export function Schedule({ machines, jobs, highlight }: { machines: Machine[]; jobs: Job[]; highlight: string | null }) {
  const host = useRef<HTMLDivElement>(null)
  const gantt = useRef<Gantt | null>(null)

  useEffect(() => {
    const now = new Date(); now.setMinutes(0, 0, 0)
    gantt.current = new Gantt({
      appendTo: host.current!,
      readOnly: true,
      rowHeight: 46,
      barMargin: 9,
      viewPreset: {
        base: 'hourAndDay',
        tickWidth: 44,
        shiftUnit: 'day',
        timeResolution: { unit: 'minute', increment: 30 },
        headers: [
          { unit: 'day', dateFormat: 'ddd D MMM' },
          { unit: 'hour', increment: 6, dateFormat: 'HH:mm' },
        ],
      },
      startDate: new Date(now.getTime() - 12 * 3600_000),
      endDate: new Date(now.getTime() + 4 * 86400_000),
      columns: [
        { type: 'name', text: 'Machine / job', width: 290 },
        { type: 'startdate', text: 'Start', width: 110, format: 'ddd HH:mm' },
        { text: 'Hours', width: 80, align: 'right', renderer: ({ record }: any) => (record.isLeaf ? `${Math.round(((record.endDate - record.startDate) / 3600_000) * 10) / 10}` : '') },
      ],
      features: {
        timeRanges: { showCurrentTimeLine: true },
        dependencies: false,
        taskEdit: false,
        cellEdit: false,
        percentBar: true,
        projectLines: false,
        rollups: false,
        labels: { right: { renderer: ({ taskRecord }: any) => (taskRecord.isLeaf ? taskRecord.name : ''), editor: false } },
      },
      project: { tasks: [] },
    } as any)
    return () => { gantt.current?.destroy(); gantt.current = null }
  }, [])

  useEffect(() => {
    const g = gantt.current
    if (!g) return
    const now = Date.now()
    const tasksData = machines.map(m => {
      const children = jobs.filter(j => j.machine_id === m.id).map(j => {
        const s = +new Date(j.start), e = +new Date(j.end)
        return {
          id: j.id, name: j.name, startDate: new Date(s), endDate: new Date(e), durationUnit: 'h', manuallyScheduled: true,
          percentDone: Math.round(Math.min(1, Math.max(0, (now - s) / (e - s))) * 100),
          cls: j.id === highlight ? 'new-job' : j.seeded ? 'seeded' : '',
          eventColor: j.id === highlight ? '#7cf2c4' : j.seeded ? '#4b5a6b' : '#3f8f74',
        }
      })
      return { id: m.id, name: m.name, expanded: true, manuallyScheduled: true, children }
    })
    let alive = true
    g.project.loadInlineData({ tasksData }).then(() => {
      if (!alive || !highlight) return
      const t = g.taskStore.getById(highlight) as any
      if (t) g.scrollTaskIntoView(t, { highlight: true, animate: { duration: 600 }, block: 'center' } as any)
    })
    return () => { alive = false }
  }, [machines, jobs, highlight])

  return <div ref={host} className="gantt-box" data-film="gantt" />
}
