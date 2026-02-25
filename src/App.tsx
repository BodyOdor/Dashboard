import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { invoke } from '@tauri-apps/api/core'
import { useGatewayChat } from './useGatewayChat'

interface Ticker {
  symbol: string
  label: string
  price: string
  change: number
}

interface Weather {
  temp: number
  condition: string
  icon: string
}

interface SystemStats {
  cpu: number
  memory_percent: number
  disk_percent: number
}

interface Task {
  text: string
  done: boolean
}

interface Project {
  id: string
  name: string
  status: string
  category: string
  description: string
  task_count: number
  tasks_done: number
  tasks: Task[]
}

function App() {
  const [time, setTime] = useState(new Date())
  const [weather, setWeather] = useState<Weather | null>(null)
  const [stats, setStats] = useState<SystemStats>({ cpu: 0, memory_percent: 0, disk_percent: 0 })
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'business' | 'personal'>('business')
  const { messages: chatMessages, sendMessage: gatewaySend, isConnected, isLoading: chatLoading } = useGatewayChat()
  const [chatInput, setChatInput] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [tickers, setTickers] = useState<Ticker[]>([])
  const chatContainerRef = useRef<HTMLDivElement>(null)
  
  const selectedProject = projects.find(p => p.id === selectedProjectId) || projects[0]
  
  const toggleListening = async () => {
    if (isListening) {
      // Stop recording, transcribe, and auto-send
      setIsListening(false)
      try {
        // Mute the system input when stopping recording
        try {
          await invoke<string>('toggle_input_mute', { state: true })
        } catch (muteErr) {
          console.error('Failed to mute input:', muteErr)
        }
        const transcript = await invoke<string>('stop_voice_input')
        if (transcript) {
          setChatInput(transcript)
          setTimeout(() => {
            setChatInput('')
            gatewaySend(transcript)
          }, 300)
        }
      } catch (err) {
        console.error('Transcription failed:', err)
      }
      return
    }

    // Start recording
    try {
      // Unmute the system input when starting recording
      try {
        await invoke<string>('toggle_input_mute', { state: false })
      } catch (unmuteErr) {
        console.error('Failed to unmute input:', unmuteErr)
      }
      await invoke<string>('start_voice_input')
      setIsListening(true)
    } catch (err) {
      console.error('Failed to start recording:', err)
    }
  }

  const sendMessage = () => {
    if (!chatInput.trim() || chatLoading) return
    const text = chatInput.trim()
    setChatInput('')
    gatewaySend(text)
  }

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [chatMessages, chatLoading])

  useEffect(() => {
    // Fetch weather from Open-Meteo (free, no API key)
    // Winston-Salem, NC
    const lat = 36.0999
    const lon = -80.2442
    
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`)
      .then(res => res.json())
      .then(data => {
        const code = data.current.weather_code
        setWeather({
          temp: Math.round(data.current.temperature_2m),
          condition: getWeatherCondition(code),
          icon: getWeatherIcon(code)
        })
      })
      .catch(err => console.error('Weather fetch failed:', err))
  }, [])

  // Fetch system stats every 2 seconds
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await invoke<SystemStats>('get_system_stats')
        setStats(data)
      } catch (err) {
        console.error('Failed to get system stats:', err)
      }
    }
    
    fetchStats()
    const interval = setInterval(fetchStats, 2000)
    return () => clearInterval(interval)
  }, [])

  // Fetch tickers every 60 seconds
  useEffect(() => {
    const fetchTickers = async () => {
      try {
        const data = await invoke<Ticker[]>('fetch_tickers')
        if (data.length > 0) setTickers(data)
      } catch (err) {
        console.error('Ticker fetch failed:', err)
      }
    }

    fetchTickers()
    const interval = setInterval(fetchTickers, 60000)
    return () => clearInterval(interval)
  }, [])

  // Fetch projects on load and poll every 10 seconds
  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const data = await invoke<Project[]>('get_projects')
        setProjects(data)
      } catch (err) {
        console.error('Failed to get projects:', err)
      }
    }
    
    fetchProjects()
    const interval = setInterval(fetchProjects, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen p-6">
      {/* Header */}
      <header className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-4xl font-bold text-white/90">
            Good {getGreeting()}, Jared
          </h1>
          <p className="text-lg text-white/60 mt-1">
            {time.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {' · '}
            {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="glass px-4 py-2 flex items-center gap-3">
          <span className="text-2xl">{weather?.icon || '🌤️'}</span>
          <div className="text-right">
            <div className="text-xl font-light">{weather?.temp ?? '--'}°</div>
            <div className="text-white/50 text-xs">{weather?.condition || 'Loading...'}</div>
          </div>
        </div>
      </header>

      {/* Ticker Bar */}
      {tickers.length > 0 && (
        <div className="glass px-4 py-3 mb-6 flex items-center justify-center gap-8">
          {tickers.map((t) => (
            <div key={t.label} className="flex items-center gap-2">
              <span className="text-lg">{t.symbol}</span>
              <span className="text-white/60 text-sm font-medium">{t.label}</span>
              <span className="text-white/90 font-semibold">{t.price}</span>
              <span className={`text-sm font-medium ${t.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {t.change >= 0 ? '▲' : '▼'} {Math.abs(t.change).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Projects Widget */}
        <div className="glass p-6 col-span-1 lg:col-span-2 flex flex-col max-h-[500px]">
          <h2 className="text-xl font-semibold text-white/80 mb-4 flex items-center justify-between shrink-0">
            <span className="flex items-center gap-2">
              <span>📁</span> Projects
            </span>
            <button
              onClick={async () => {
                const data = await invoke<Project[]>('get_projects')
                setProjects(data)
              }}
              className="text-sm text-white/40 hover:text-white/70 transition-colors"
              title="Refresh projects"
            >
              ↻
            </button>
          </h2>
          <div className="flex mb-4 shrink-0">
            <button
              onClick={() => setActiveTab('business')}
              className={`px-4 py-2 rounded-t-lg border-b-2 ${activeTab === 'business' ? 'border-blue-500 text-blue-400 bg-white/10' : 'border-transparent text-white/50 hover:text-white/80 hover:bg-white/5'} transition-all`}
            >
              Business
            </button>
            <button
              onClick={() => setActiveTab('personal')}
              className={`px-4 py-2 rounded-t-lg border-b-2 ${activeTab === 'personal' ? 'border-blue-500 text-blue-400 bg-white/10' : 'border-transparent text-white/50 hover:text-white/80 hover:bg-white/5'} transition-all`}
            >
              Personal
            </button>
          </div>
          <div className="space-y-3 flex-1 overflow-y-auto min-h-0">
            {(() => {
              const filtered = projects.filter(project => {
                return activeTab === 'business' 
                  ? project.category.toLowerCase() === 'business'
                  : project.category.toLowerCase() !== 'business'
              })
              const active = filtered.filter(p => !(p.task_count > 0 && p.tasks_done === p.task_count))
              const completed = filtered.filter(p => p.task_count > 0 && p.tasks_done === p.task_count)
              
              return filtered.length > 0 ? (
                <>
                  {active.map((project) => (
                    <ProjectCard 
                      key={project.id}
                      id={project.id}
                      name={project.name} 
                      status={project.status.toLowerCase().includes('active') ? 'active' : 'paused'} 
                      description={project.description}
                      tasks={project.task_count > 0 ? `${project.tasks_done}/${project.task_count} tasks` : undefined}
                      selected={project.id === selectedProject?.id}
                      onClick={() => setSelectedProjectId(project.id)}
                    />
                  ))}
                  {completed.length > 0 && (
                    <details className="mt-4">
                      <summary className="text-white/40 text-xs uppercase tracking-wider cursor-pointer hover:text-white/60 transition-colors py-2">
                        Completed ({completed.length})
                      </summary>
                      <div className="space-y-3 mt-3">
                        {completed.map((project) => (
                          <ProjectCard 
                            key={project.id}
                            id={project.id}
                            name={project.name} 
                            status={'paused'} 
                            description={project.description}
                            tasks={`${project.tasks_done}/${project.task_count} tasks ✓`}
                            selected={project.id === selectedProject?.id}
                            onClick={() => setSelectedProjectId(project.id)}
                          />
                        ))}
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <p className="text-white/40 text-sm">No projects found. Add .md files to ~/.openclaw/workspace/projects/</p>
              )
            })()}
          </div>
        </div>

        {/* Tasks Widget */}
        <div className="glass p-6 flex flex-col max-h-[500px]">
          <h2 className="text-xl font-semibold text-white/80 mb-4 flex items-center gap-2 shrink-0">
            <span>✓</span> {selectedProject ? selectedProject.name : 'Tasks'}
          </h2>
          <div className="space-y-2 flex-1 overflow-y-auto min-h-0">
            {selectedProject && selectedProject.tasks.length > 0 ? (
              [...selectedProject.tasks.map((t, i) => ({ ...t, origIndex: i }))]
                .sort((a, b) => Number(a.done) - Number(b.done))
                .map((task) => (
                  <TaskItem 
                    key={task.origIndex} 
                    text={task.text} 
                    done={task.done} 
                    onToggle={async () => {
                      try {
                        await invoke('toggle_task', { projectId: selectedProject.id, taskIndex: task.origIndex })
                        const data = await invoke<Project[]>('get_projects')
                        setProjects(data)
                      } catch (err) {
                        console.error('Failed to toggle task:', err)
                      }
                    }}
                  />
                ))
            ) : (
              <p className="text-white/40 text-sm">No tasks for this project</p>
            )}
          </div>
        </div>

        {/* System Stats Widget */}
        <div className="glass p-6">
          <h2 className="text-xl font-semibold text-white/80 mb-4 flex items-center gap-2">
            <span>💻</span> System
          </h2>
          <div className="space-y-3">
            <StatBar label="CPU" value={Math.round(stats.cpu)} />
            <StatBar label="RAM" value={Math.round(stats.memory_percent)} />
            <StatBar label="Storage" value={Math.round(stats.disk_percent)} />
          </div>
        </div>

        {/* Larry Chat Widget */}
        <div className="glass p-6 col-span-1 lg:col-span-2">
          <h2 className="text-xl font-semibold text-white/80 mb-4 flex items-center gap-2">
            <span>🛠️</span> Larry
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} title={isConnected ? 'Connected' : 'Disconnected'} />
          </h2>
          <div ref={chatContainerRef} className="bg-white/10 rounded-lg p-4 h-48 mb-3 overflow-y-auto text-lg text-white/90 flex flex-col gap-3 backdrop-blur-sm border border-white/10">
            {chatMessages.slice(-50).map((msg, i) => {
              // Error messages: red/muted inline indicator instead of normal assistant bubble
              if (msg.isError) {
                return (
                  <div key={i + (chatMessages.length - 50)} className="self-start max-w-[80%] px-3 py-2 rounded-lg bg-red-900/30 border border-red-500/30 text-red-300/80 text-sm italic">
                    ⚠ {msg.text}
                  </div>
                )
              }
              return (
                <div key={i + (chatMessages.length - 50)} className={`max-w-[80%] p-2 rounded-lg ${msg.role === 'user' ? 'self-end bg-blue-500/20 text-white/90' : 'self-start bg-gray-800/30 text-white/90'}`}>
                  <span className={`text-sm font-medium ${msg.role === 'assistant' ? 'text-blue-400' : 'text-green-400'}`}>
                    {msg.role === 'assistant' ? 'Larry' : 'You'}
                  </span>
                  <div className="mt-1 text-base leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-300 underline hover:text-blue-400">{children}</a> }}>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                </div>
              )
            })}
            {chatLoading && (
              <div className="self-start p-2 rounded-lg bg-gray-800/30 text-white/40 italic text-sm">Larry is thinking...</div>
            )}
          </div>
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="Ask Larry something..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              disabled={chatLoading}
              className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:border-blue-400/50 disabled:opacity-50"
            />
            <button 
              onClick={toggleListening}
              disabled={chatLoading}
              className={`px-4 py-2 rounded-lg transition-colors ${
                isListening 
                  ? 'bg-red-500/40 text-red-400 animate-pulse' 
                  : 'bg-white/15 text-white/70 hover:bg-white/25 hover:text-white/90'
              } disabled:opacity-50`}
              title={isListening ? 'Stop listening' : 'Voice input'}
            >
              🎤
            </button>
            <button 
              onClick={sendMessage}
              disabled={chatLoading || !chatInput.trim()}
              className="px-4 py-2 bg-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/40 transition-colors disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
}

function getWeatherCondition(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Partly Cloudy'
  if (code <= 49) return 'Foggy'
  if (code <= 59) return 'Drizzle'
  if (code <= 69) return 'Rain'
  if (code <= 79) return 'Snow'
  if (code <= 99) return 'Thunderstorm'
  return 'Unknown'
}

function getWeatherIcon(code: number): string {
  if (code === 0) return '☀️'
  if (code <= 3) return '⛅'
  if (code <= 49) return '🌫️'
  if (code <= 59) return '🌧️'
  if (code <= 69) return '🌧️'
  if (code <= 79) return '❄️'
  if (code <= 99) return '⛈️'
  return '🌤️'
}

/**
 * PROJECT_AGENTS — Agent-to-project mapping
 *
 * OWNER: Dash 🖥️ (dashboard dev agent) is responsible for maintaining this map.
 *
 * WHAT IT IS:
 *   Maps a project file ID (markdown filename without .md extension, e.g. "brightwavefx")
 *   to one or more agent display strings (e.g. ["Wave 🌊"]). Multiple agents are supported
 *   for projects with more than one assigned specialist.
 *
 * HOW TO UPDATE:
 *   - When a new project or agent is added to the workspace, add a corresponding entry here.
 *   - Key = the .md filename (without extension) found in ~/.openclaw/workspace/projects/
 *   - Value = array of agent label strings, e.g. ['Bolt ⚡'] or ['Wave 🌊', 'Flare 🔥']
 *   - Entries with no matching project file are safely ignored at runtime.
 *
 * WHY HERE:
 *   Frontend-only mapping avoids coupling the Rust parser or project markdown files to agent
 *   metadata. Project IDs are stable identifiers; agent assignment is a dashboard concern.
 */
const PROJECT_AGENTS: Record<string, string[]> = {
  'brightwavefx':             ['Wave 🌊'],
  'brightwavefx-social':      ['Flare 🔥'],
  'outbound-sales-portal':    ['Bolt ⚡'],
  'outbound-sales-research':  ['Bolt ⚡'],
  'bitcoin-merch':            ['Stitch 🧵'],
  'satstitch':                ['Stitch 🧵'],
  'dashboard-app':            ['Dash 🖥️'],
  'aaay-o-kaay':              ['Kay 💛'],
}

function ProjectCard({ id, name, status, description, tasks, selected, onClick }: { 
  id: string;
  name: string; 
  status: 'active' | 'paused'; 
  description: string; 
  tasks?: string;
  selected?: boolean;
  onClick?: () => void;
}) {
  const agents = PROJECT_AGENTS[id] ?? []

  return (
    <div 
      className={`glass-hover bg-white/5 rounded-lg p-4 cursor-pointer transition-all ${
        selected ? 'ring-2 ring-blue-500/50 bg-white/10' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-medium text-white/90 truncate">{name}</h3>
          {agents.map(agent => (
            <span
              key={agent}
              className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/60 border border-white/15"
              title={`Assigned agent: ${agent}`}
            >
              {agent}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {tasks && <span className="text-xs text-white/40">{tasks}</span>}
          <span className={`text-xs px-2 py-1 rounded-full ${
            status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
          }`}>
            {status}
          </span>
        </div>
      </div>
      <p className="text-sm text-white/50 line-clamp-2">{description}</p>
    </div>
  )
}

function TaskItem({ text, done, onToggle }: { text: string; done: boolean; onToggle?: () => void }) {
  return (
    <div 
      className="flex items-center gap-3 text-lg cursor-pointer hover:bg-white/5 rounded-lg px-2 py-1 -mx-2 transition-colors"
      onClick={onToggle}
    >
      <div className={`w-5 h-5 shrink-0 rounded-md border ${
        done ? 'bg-green-500/50 border-green-500' : 'border-white/30 hover:border-white/60'
      } flex items-center justify-center transition-colors`}>
        {done && <span className="text-sm">✓</span>}
      </div>
      <span className={done ? 'text-white/40 line-through' : 'text-white/70'}>{text}</span>
    </div>
  )
}

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-white/60">{label}</span>
        <span className="text-white/80">{value}%</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  )
}

export default App
