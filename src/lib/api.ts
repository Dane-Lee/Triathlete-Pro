import {
  AthleteProfile,
  AuthSession,
  CalibrationTest,
  CoachAssignment,
  CoefficientSet,
  LoginRequest,
  ReadinessSnapshot,
  RegisterRequest,
  TrainingSession,
  TrainingSessionInput,
} from '../shared/domain';
import type {
  ConnectionChange,
  EcosystemStatus,
} from '../ecosystem-control-center';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8787';
const TOKEN_KEY = 'triathlete-api-token';

export const authStore = {
  getToken: () => window.localStorage.getItem(TOKEN_KEY),
  setToken: (token: string) => window.localStorage.setItem(TOKEN_KEY, token),
  clearToken: () => window.localStorage.removeItem(TOKEN_KEY),
};

const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const token = authStore.getToken();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }
  return payload as T;
};

export const api = {
  async login(body: LoginRequest) {
    const session = await request<AuthSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    authStore.setToken(session.token);
    return session;
  },

  async register(body: RegisterRequest) {
    return request<{ user: AuthSession['user'] }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async logout() {
    await request('/auth/logout', { method: 'POST', body: JSON.stringify({}) }).catch(() => undefined);
    authStore.clearToken();
  },

  me() {
    return request<Omit<AuthSession, 'token'>>('/auth/me');
  },

  athletes() {
    return request<AthleteProfile[]>('/athletes');
  },

  updateAthlete(id: string, patch: Partial<AthleteProfile>) {
    return request<AthleteProfile>(`/athletes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  },

  assignments() {
    return request<CoachAssignment[]>('/coaches/assignments');
  },

  createAssignment(athleteId: string) {
    return request<CoachAssignment>('/coaches/assignments', {
      method: 'POST',
      body: JSON.stringify({ athleteId }),
    });
  },

  sessions(athleteId: string) {
    return request<TrainingSession[]>(`/sessions?athleteId=${encodeURIComponent(athleteId)}`);
  },

  createSession(input: TrainingSessionInput) {
    return request<TrainingSession>('/sessions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  deleteSession(id: string) {
    return request<{ success: true }>(`/sessions/${id}`, { method: 'DELETE' });
  },

  recomputeSessions(athleteId: string) {
    return request<TrainingSession[]>('/sessions/recompute', {
      method: 'POST',
      body: JSON.stringify({ athleteId }),
    });
  },

  readiness(athleteId: string, date: string) {
    return request<ReadinessSnapshot>(`/readiness?athleteId=${encodeURIComponent(athleteId)}&date=${encodeURIComponent(date)}`);
  },

  calculateReadiness(athleteId: string, date: string) {
    return request<ReadinessSnapshot>('/readiness/calculate', {
      method: 'POST',
      body: JSON.stringify({ athleteId, date }),
    });
  },

  coefficients(athleteId?: string) {
    const query = athleteId ? `?athleteId=${encodeURIComponent(athleteId)}` : '';
    return request<CoefficientSet[]>(`/coefficients${query}`);
  },

  calibrationTests(athleteId: string) {
    return request<CalibrationTest[]>(`/calibration?athleteId=${encodeURIComponent(athleteId)}`);
  },

  createCalibration(input: Omit<CalibrationTest, 'id' | 'createdAt'>) {
    return request<CalibrationTest>('/calibration', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  ecosystemStatus() {
    return request<EcosystemStatus>('/ecosystem/status');
  },

  updateEcosystemConnection(
    status: EcosystemStatus,
    change: ConnectionChange
  ) {
    const current =
      status.connections.find(report => report.app === 'triathletePro')
        ?.settings ?? {
        version: 1,
        outbound: {},
        inbound: {},
        updatedAt: '1970-01-01T00:00:00.000Z',
      };
    const direction =
      typeof current[change.direction] === 'object' &&
      current[change.direction] !== null
        ? (current[change.direction] as Record<string, unknown>)
        : {};
    return request<Record<string, unknown>>('/ecosystem/connections', {
      method: 'PUT',
      body: JSON.stringify({
        ...current,
        [change.direction]: {
          ...direction,
          [change.payloadType]: change.state,
        },
      }),
    });
  },
};
