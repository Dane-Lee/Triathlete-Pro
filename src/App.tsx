import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType, FormEvent } from 'react';
import {
  Activity,
  Bike,
  ClipboardCheck,
  Database,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
  UserRound,
  Waves,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, authStore } from './lib/api';
import { useEcosystemControlCenter } from './lib/useEcosystemControlCenter';
import {
  ControlCenter,
  ControlCenterLauncher,
  useControlCenterHotkey,
} from './ecosystem-control-center';
import {
  AthleteProfile,
  AuthSession,
  CalibrationTest,
  CoefficientSet,
  ConfidenceLevel,
  Discipline,
  ReadinessSnapshot,
  RegisterRequest,
  Role,
  TrainingSession,
  TrainingSessionInput,
} from './shared/domain';

type View = 'dashboard' | 'sessions' | 'profile' | 'coach' | 'model' | 'calibration';
type ThemeMode = 'light' | 'dark';

const today = () => new Date().toISOString().slice(0, 10);

const confidenceText: Record<ConfidenceLevel, string> = {
  'estimated-default': 'Estimated default',
  'partially-calibrated': 'Partially calibrated',
  'fully-calibrated': 'Fully calibrated',
};

const stateClass = {
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800',
  caution: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800',
  overload: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800',
};

const disciplineIcons: Record<Discipline, ComponentType<{ className?: string }>> = {
  swim: Waves,
  bike: Bike,
  run: Activity,
};

function formatLoad(value: number) {
  return Number.isFinite(value) ? value.toFixed(1) : '0.0';
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function ThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const isDark = theme === 'dark';
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={label}
      title={label}
      onClick={onToggle}
      className="focus-ring inline-flex h-10 w-10 flex-none items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function LoginScreen({ onLogin, theme, onToggleTheme }: { onLogin: (session: AuthSession) => void; theme: ThemeMode; onToggleTheme: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('coach@local.test');
  const [password, setPassword] = useState('password123');
  const [name, setName] = useState('New User');
  const [role, setRole] = useState<Role>('athlete');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'register') {
        const body: RegisterRequest = { email, password, name, role };
        await api.register(body);
      }
      const session = await api.login({ email, password });
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 transition-colors dark:bg-slate-950 dark:text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10">
        <section className="grid w-full gap-10 lg:grid-cols-[1fr_420px] lg:items-center">
          <div>
            <div className="mb-8 flex items-start justify-between gap-4 sm:items-center">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-sky-500">
                  <Activity className="h-7 w-7" />
                </div>
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight">Triathlete Energy Tracker</h1>
                  <p className="text-slate-600 dark:text-slate-300">SQLite-backed coaching support with auditable load calculations.</p>
                </div>
              </div>
              <ThemeToggle theme={theme} onToggle={onToggleTheme} />
            </div>
            <div className="grid gap-4 text-slate-700 dark:text-slate-200 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <Database className="mb-3 h-6 w-6 text-sky-300" />
                <h2 className="font-semibold">Local SQLite</h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">No hosted backend dependency. Data is stored by the local API.</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <ShieldCheck className="mb-3 h-6 w-6 text-emerald-300" />
                <h2 className="font-semibold">Coach Access</h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Coaches only see athletes assigned to them.</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <ClipboardCheck className="mb-3 h-6 w-6 text-amber-300" />
                <h2 className="font-semibold">Traceable Math</h2>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Calculations include confidence, warnings, and trace steps.</p>
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="rounded-lg bg-white p-6 text-slate-900 shadow-2xl dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/30">
            <div className="mb-5 flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button type="button" onClick={() => setMode('login')} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${mode === 'login' ? 'bg-white shadow dark:bg-slate-700' : 'text-slate-600 dark:text-slate-300'}`}>
                Sign in
              </button>
              <button type="button" onClick={() => setMode('register')} className={`flex-1 rounded-md px-3 py-2 text-sm font-medium ${mode === 'register' ? 'bg-white shadow dark:bg-slate-700' : 'text-slate-600 dark:text-slate-300'}`}>
                Register
              </button>
            </div>

            {mode === 'register' && (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium">Name</label>
                <input value={name} onChange={(event) => setName(event.target.value)} className="focus-ring w-full rounded-md border border-slate-300 px-3 py-2" />
              </div>
            )}

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="focus-ring w-full rounded-md border border-slate-300 px-3 py-2" />
            </div>

            <div className="mb-4">
              <label className="mb-1 block text-sm font-medium">Password</label>
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="focus-ring w-full rounded-md border border-slate-300 px-3 py-2" />
            </div>

            {mode === 'register' && (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium">Role</label>
                <select value={role} onChange={(event) => setRole(event.target.value as Role)} className="focus-ring w-full rounded-md border border-slate-300 px-3 py-2">
                  <option value="athlete">Athlete</option>
                  <option value="coach">Coach</option>
                </select>
              </div>
            )}

            {error && <p className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">{error}</p>}

            <button disabled={busy} className="focus-ring w-full rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
              {busy ? 'Working...' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>

            <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Local starter accounts: coach@local.test and athlete@local.test, both using password123.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">{value}</p>
      {detail && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{detail}</p>}
    </div>
  );
}

function SessionForm({ athleteId, onCreated }: { athleteId: string; onCreated: () => Promise<void> }) {
  const [discipline, setDiscipline] = useState<Discipline>('swim');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    date: today(),
    sessionType: 'training',
    distanceMeters: 1000,
    durationSeconds: 1200,
    perceivedExertion: 5,
    averageHeartRateBpm: 145,
    swimPaceSecondsPer100m: 120,
    runPaceSecondsPerKm: 330,
    bikePowerWatts: 180,
    notes: '',
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input: TrainingSessionInput = {
        athleteId,
        date: form.date,
        discipline,
        sessionType: form.sessionType as TrainingSessionInput['sessionType'],
        distanceMeters: Number(form.distanceMeters),
        durationSeconds: Number(form.durationSeconds),
        perceivedExertion: Number(form.perceivedExertion),
        averageHeartRateBpm: form.averageHeartRateBpm ? Number(form.averageHeartRateBpm) : undefined,
        swimPaceSecondsPer100m: discipline === 'swim' ? Number(form.swimPaceSecondsPer100m) : undefined,
        runPaceSecondsPerKm: discipline === 'run' ? Number(form.runPaceSecondsPerKm) : undefined,
        bikePowerWatts: discipline === 'bike' ? Number(form.bikePowerWatts) : undefined,
        notes: form.notes || undefined,
      };
      await api.createSession(input);
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save session.');
    } finally {
      setBusy(false);
    }
  };

  const update = (key: keyof typeof form, value: string | number) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
      <h3 className="mb-4 text-lg font-semibold text-slate-950 dark:text-white">Add Session</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Discipline</span>
          <select value={discipline} onChange={(event) => setDiscipline(event.target.value as Discipline)} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2">
            <option value="swim">Swim</option>
            <option value="bike">Bike</option>
            <option value="run">Run</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Date</span>
          <input type="date" value={form.date} onChange={(event) => update('date', event.target.value)} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Type</span>
          <select value={form.sessionType} onChange={(event) => update('sessionType', event.target.value)} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2">
            <option value="training">Training</option>
            <option value="competition">Competition</option>
            <option value="test">Test</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Distance (m)</span>
          <input type="number" min="1" value={form.distanceMeters} onChange={(event) => update('distanceMeters', Number(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Duration (s)</span>
          <input type="number" min="1" value={form.durationSeconds} onChange={(event) => update('durationSeconds', Number(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">RPE (1-10)</span>
          <input type="number" min="1" max="10" value={form.perceivedExertion} onChange={(event) => update('perceivedExertion', Number(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label className="block">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Avg HR</span>
          <input type="number" value={form.averageHeartRateBpm} onChange={(event) => update('averageHeartRateBpm', Number(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        {discipline === 'swim' && (
          <label className="block">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Swim pace (s/100m)</span>
            <input type="number" value={form.swimPaceSecondsPer100m} onChange={(event) => update('swimPaceSecondsPer100m', Number(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
        )}
        {discipline === 'bike' && (
          <label className="block">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Power (W)</span>
            <input type="number" value={form.bikePowerWatts} onChange={(event) => update('bikePowerWatts', Number(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
        )}
        {discipline === 'run' && (
          <label className="block">
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Run pace (s/km)</span>
            <input type="number" value={form.runPaceSecondsPerKm} onChange={(event) => update('runPaceSecondsPerKm', Number(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
          </label>
        )}
      </div>
      <label className="mt-4 block">
        <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Notes</span>
        <textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" rows={2} />
      </label>
      {error && <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">{error}</p>}
      <button disabled={busy} className="focus-ring mt-4 rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700 disabled:opacity-60">
        {busy ? 'Saving...' : 'Save Session'}
      </button>
    </form>
  );
}

function ProfileEditor({ athlete, onSaved }: { athlete: AthleteProfile; onSaved: (athlete: AthleteProfile) => void }) {
  const [draft, setDraft] = useState(athlete);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(athlete), [athlete]);

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.updateAthlete(athlete.id, draft);
      onSaved(saved);
    } finally {
      setBusy(false);
    }
  };

  const numberOrUndefined = (value: string) => value === '' ? undefined : Number(value);
  const update = (key: keyof AthleteProfile, value: string | number | undefined) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
      <h3 className="mb-4 text-lg font-semibold text-slate-950 dark:text-white">Athlete Profile and Defaults</h3>
      <div className="grid gap-4 md:grid-cols-3">
        <label>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Name</span>
          <input value={draft.name} onChange={(event) => update('name', event.target.value)} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Body mass (kg)</span>
          <input type="number" value={draft.bodyMassKg ?? ''} onChange={(event) => update('bodyMassKg', numberOrUndefined(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Resting HR</span>
          <input type="number" value={draft.restingHeartRateBpm ?? ''} onChange={(event) => update('restingHeartRateBpm', numberOrUndefined(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Swim critical velocity (m/s)</span>
          <input type="number" step="0.01" value={draft.swimCriticalVelocityMps ?? ''} onChange={(event) => update('swimCriticalVelocityMps', numberOrUndefined(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Bike FTP (W)</span>
          <input type="number" value={draft.bikeFunctionalThresholdPowerWatts ?? ''} onChange={(event) => update('bikeFunctionalThresholdPowerWatts', numberOrUndefined(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
        <label>
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Run critical velocity (m/s)</span>
          <input type="number" step="0.01" value={draft.runCriticalVelocityMps ?? ''} onChange={(event) => update('runCriticalVelocityMps', numberOrUndefined(event.target.value))} className="focus-ring mt-1 w-full rounded-md border border-slate-300 px-3 py-2" />
        </label>
      </div>
      <button onClick={save} disabled={busy} className="focus-ring mt-4 rounded-md bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-300">
        {busy ? 'Saving...' : 'Save Profile'}
      </button>
    </section>
  );
}

function App() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [session, setSession] = useState<Omit<AuthSession, 'token'> | null>(null);
  const [athletes, setAthletes] = useState<AthleteProfile[]>([]);
  const [selectedAthleteId, setSelectedAthleteId] = useState('');
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [readiness, setReadiness] = useState<ReadinessSnapshot | null>(null);
  const [coefficients, setCoefficients] = useState<CoefficientSet[]>([]);
  const [calibrations, setCalibrations] = useState<CalibrationTest[]>([]);
  const [view, setView] = useState<View>('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [controlCenterOpen, setControlCenterOpen] = useState(false);
  const ecosystem = useEcosystemControlCenter(Boolean(session));
  useControlCenterHotkey(
    () => setControlCenterOpen((open) => !open),
    Boolean(session),
  );

  const selectedAthlete = useMemo(
    () => athletes.find((athlete) => athlete.id === selectedAthleteId) ?? athletes[0],
    [athletes, selectedAthleteId],
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');

  const loadInitial = async () => {
    if (!authStore.getToken()) {
      setLoading(false);
      return;
    }
    try {
      const me = await api.me();
      setSession(me);
    } catch {
      authStore.clearToken();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInitial();
  }, []);

  const refreshAthletes = useCallback(async () => {
    const rows = await api.athletes();
    setAthletes(rows);
    if (!selectedAthleteId && rows[0]) setSelectedAthleteId(rows[0].id);
  }, [selectedAthleteId]);

  useEffect(() => {
    if (!session) return;
    void refreshAthletes();
  }, [session, refreshAthletes]);

  const refreshAthleteData = useCallback(async (athleteId: string) => {
    if (!athleteId) return;
    const [sessionRows, readinessRow, coefficientRows, calibrationRows] = await Promise.all([
      api.sessions(athleteId),
      api.calculateReadiness(athleteId, today()),
      api.coefficients(athleteId),
      api.calibrationTests(athleteId),
    ]);
    setSessions(sessionRows);
    setReadiness(readinessRow);
    setCoefficients(coefficientRows);
    setCalibrations(calibrationRows);
  }, []);

  useEffect(() => {
    if (!selectedAthlete?.id) return;
    void refreshAthleteData(selectedAthlete.id).catch((err) => setError(err instanceof Error ? err.message : 'Unable to load athlete data.'));
  }, [selectedAthlete?.id, refreshAthleteData]);

  const signOut = async () => {
    await api.logout();
    setSession(null);
    setAthletes([]);
    setSelectedAthleteId('');
  };

  const onLogin = (authSession: AuthSession) => {
    setSession({ user: authSession.user, athlete: authSession.athlete });
  };

  const chartData = [...sessions]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(-14)
    .map((row) => ({
      date: row.date.slice(5),
      aerobic: row.aerobicLoad,
      anaerobic: row.anaerobicLoad,
      discipline: row.discipline,
    }));

  const totalLoad = sessions.reduce((sum, row) => sum + row.normalizedLoad, 0);
  const activeCoefficient = coefficients.find((row) => row.active) ?? coefficients[0];
  const nav: Array<{ id: View; label: string }> = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'profile', label: 'Profile' },
    { id: 'calibration', label: 'Calibration' },
    { id: 'model', label: 'Model' },
    { id: 'coach', label: 'Coach' },
  ];
  const chartStroke = theme === 'dark' ? '#334155' : '#e2e8f0';
  const chartText = theme === 'dark' ? '#cbd5e1' : '#475569';
  const tooltipStyle = theme === 'dark'
    ? { backgroundColor: '#0f172a', border: '1px solid #334155', color: '#e2e8f0' }
    : { backgroundColor: '#ffffff', border: '1px solid #e2e8f0', color: '#0f172a' };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600 dark:bg-slate-950 dark:text-slate-300">Loading local tracker...</div>;
  }

  if (!session) {
    return <LoginScreen onLogin={onLogin} theme={theme} onToggleTheme={toggleTheme} />;
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950 transition-colors dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-600 text-white">
              <Activity className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-950 dark:text-white">Triathlete Energy Tracker</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{session.user.name} - {session.user.role}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ControlCenterLauncher
              status={ecosystem.status}
              onClick={() => setControlCenterOpen(true)}
            />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            <select value={selectedAthlete?.id ?? ''} onChange={(event) => setSelectedAthleteId(event.target.value)} className="focus-ring rounded-md border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
              {athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}
            </select>
            <button onClick={() => selectedAthlete?.id && void refreshAthleteData(selectedAthlete.id)} className="focus-ring inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-800">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button onClick={signOut} className="focus-ring inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-300">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      </header>

      <ControlCenter
        hostApp="triathletePro"
        status={ecosystem.status}
        loading={ecosystem.loading}
        error={ecosystem.error}
        open={controlCenterOpen}
        onClose={() => setControlCenterOpen(false)}
        onRefresh={ecosystem.refresh}
        onConnectionChange={ecosystem.setConnection}
      />

      <div className="mx-auto max-w-7xl px-6 py-6">
        <nav className="mb-6 flex flex-wrap gap-2">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`focus-ring rounded-md px-4 py-2 text-sm font-medium transition-colors ${view === item.id ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950' : 'bg-white text-slate-700 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'}`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {error && <p className="mb-4 rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">{error}</p>}

        {!selectedAthlete && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            No athlete profile is available for this account yet.
          </section>
        )}

        {selectedAthlete && view === 'dashboard' && (
          <section className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <StatCard label="Overall readiness" value={readiness ? `${readiness.overallScore.toFixed(0)}%` : 'n/a'} detail={readiness?.overallState} />
              <StatCard label="Total load" value={formatLoad(totalLoad)} detail={`${sessions.length} sessions`} />
              <StatCard label="Limiting discipline" value={readiness?.limitingDiscipline ?? 'n/a'} detail="Lowest readiness score" />
              <StatCard label="Model confidence" value={activeCoefficient ? confidenceText[activeCoefficient.confidenceLevel] : 'n/a'} detail={activeCoefficient?.version} />
              <StatCard label="Evidence maturity" value="Research provisional" detail="Not externally validated" />
            </div>

            {readiness && (
              <div className={`rounded-lg border p-4 ${stateClass[readiness.overallState]}`}>
                <h2 className="font-semibold">Recommendation</h2>
                <p className="mt-1">{readiness.recommendation}</p>
                {readiness.warnings.map((warning) => <p key={warning} className="mt-2 text-sm">{warning}</p>)}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-3">
              {readiness && (['swim', 'bike', 'run'] as Discipline[]).map((discipline) => {
                const data = readiness[discipline];
                const Icon = disciplineIcons[discipline];
                return (
                  <div key={discipline} className={`rounded-lg border bg-white p-4 shadow-sm ${stateClass[data.state]}`}>
                    <div className="mb-3 flex items-center gap-2">
                      <Icon className="h-5 w-5" />
                      <h3 className="font-semibold capitalize">{discipline}</h3>
                    </div>
                    <p className="text-3xl font-semibold">{data.readinessScore.toFixed(0)}%</p>
                    <p className="mt-2 text-sm">Fatigue {data.fatigueIndex.toFixed(1)} - Carryover penalty {data.carryoverPenalty.toFixed(1)}</p>
                  </div>
                );
              })}
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
              <h2 className="mb-4 text-lg font-semibold">Recent Load</h2>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartStroke} />
                    <XAxis dataKey="date" tick={{ fill: chartText }} axisLine={{ stroke: chartStroke }} tickLine={{ stroke: chartStroke }} />
                    <YAxis tick={{ fill: chartText }} axisLine={{ stroke: chartStroke }} tickLine={{ stroke: chartStroke }} />
                    <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: chartText }} itemStyle={{ color: chartText }} />
                    <Legend wrapperStyle={{ color: chartText }} />
                    <Bar dataKey="aerobic" stackId="load" fill="#0284c7" />
                    <Bar dataKey="anaerobic" stackId="load" fill="#f97316" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>
        )}

        {selectedAthlete && view === 'sessions' && (
          <section className="space-y-6">
            <SessionForm athleteId={selectedAthlete.id} onCreated={() => refreshAthleteData(selectedAthlete.id)} />
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    {['Date', 'Discipline', 'Duration', 'Load', 'Confidence', 'Warnings', ''].map((heading) => (
                      <th key={heading} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sessions.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 text-sm">{row.date}</td>
                      <td className="px-4 py-3 text-sm capitalize">{row.discipline}</td>
                      <td className="px-4 py-3 text-sm">{formatDuration(row.durationSeconds)}</td>
                      <td className="px-4 py-3 text-sm font-semibold">{formatLoad(row.normalizedLoad)}</td>
                      <td className="px-4 py-3 text-sm">{confidenceText[row.confidenceLevel]}</td>
                      <td className="px-4 py-3 text-sm text-amber-700 dark:text-amber-300">{row.calculationTrace.warnings.length}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={async () => {
                            await api.deleteSession(row.id);
                            await refreshAthleteData(selectedAthlete.id);
                          }}
                          className="text-sm font-medium text-rose-600 hover:text-rose-800 dark:text-rose-300 dark:hover:text-rose-200"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {selectedAthlete && view === 'profile' && (
          <ProfileEditor
            athlete={selectedAthlete}
            onSaved={(saved) => {
              setAthletes((prev) => prev.map((athlete) => athlete.id === saved.id ? saved : athlete));
            }}
          />
        )}

        {selectedAthlete && view === 'calibration' && (
          <section className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
              <h2 className="text-lg font-semibold">Calibration Records</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Store protocol results here before activating calibrated coefficients. Defaults remain labeled until calibration is reviewed.
              </p>
              <button
                onClick={async () => {
                  await api.createCalibration({
                    athleteId: selectedAthlete.id,
                    testType: 'swim_energy',
                    testDate: today(),
                    protocolData: { protocol: '5x200m incremental', units: 'velocity m/s, energy J/kg/s' },
                    measurements: [],
                    results: { status: 'record created; measurements pending' },
                    isValid: false,
                    confidenceLevel: 'estimated-default',
                  });
                  setCalibrations(await api.calibrationTests(selectedAthlete.id));
                }}
                className="focus-ring mt-4 rounded-md bg-sky-600 px-4 py-2 font-semibold text-white hover:bg-sky-700"
              >
                Add Swim Calibration Record
              </button>
            </div>
            {calibrations.map((row) => (
              <div key={row.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
                <p className="font-semibold">{row.testType.replace('_', ' ')} - {row.testDate}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">{confidenceText[row.confidenceLevel]} - {row.isValid ? 'valid' : 'pending validation'}</p>
              </div>
            ))}
          </section>
        )}

        {selectedAthlete && view === 'model' && (
          <section className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
              <h2 className="text-lg font-semibold">Coefficient Sets</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Calculation outputs include source coefficient version, athlete-data confidence, evidence maturity, warnings, and trace steps. The backend is authoritative.
              </p>
              <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                Athlete calibration and external model validation are separate. Every current coefficient set remains research provisional.
              </p>
              <button
                onClick={async () => {
                  await api.recomputeSessions(selectedAthlete.id);
                  await refreshAthleteData(selectedAthlete.id);
                }}
                className="focus-ring mt-4 rounded-md bg-slate-900 px-4 py-2 font-semibold text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-slate-300"
              >
                Recompute Sessions
              </button>
            </div>
            {coefficients.map((row) => (
              <div key={row.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">{row.version} - {confidenceText[row.confidenceLevel]}</p>
                  </div>
                  {row.active && <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-200">Active</span>}
                </div>
              </div>
            ))}
          </section>
        )}

        {view === 'coach' && (
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/20">
            <div className="flex items-center gap-2">
              <UserRound className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              <h2 className="text-lg font-semibold">Coach Workspace</h2>
            </div>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Assigned athletes are listed in the athlete selector. The API enforces coach-athlete access on every athlete, session, readiness, calibration, and coefficient route.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {athletes.map((athlete) => (
                <button key={athlete.id} onClick={() => setSelectedAthleteId(athlete.id)} className="focus-ring rounded-lg border border-slate-200 p-4 text-left hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800">
                  <p className="font-semibold">{athlete.name}</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{athlete.email}</p>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

export default App;
