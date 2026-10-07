import './film/clock.ts' // must be first: installs the virtual clock for ?film=1
import { createRoot } from 'react-dom/client'
import '@bryntum/gantt/gantt.css'
import '@bryntum/gantt/svalbard-dark.css'
import '@bryntum/gantt/fontawesome/css/fontawesome.css'
import '@bryntum/gantt/fontawesome/css/solid.css'
import './styles.css'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(<App />)
