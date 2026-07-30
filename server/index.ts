import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { AppDatabase } from './db';
import { EcosystemSync } from './ecosystemSync';
import {
  fetchHubStatus,
  loadConnectionSettings,
  reportToHub,
  saveConnectionSettings,
} from './connectionSettings';
import { parseConnectionSettings } from '../src/ecosystem-contracts/connections';
import {
  CalibrationTest,
  CoefficientSet,
  LoginRequest,
  RegisterRequest,
  TrainingSessionInput,
  User,
} from '../src/shared/domain';

const port = Number(process.env.TRIATHLETE_API_PORT ?? 8787);
const dbPath = process.env.TRIATHLETE_DB_PATH ?? './data/triathlete.sqlite';
const db = new AppDatabase(dbPath);
const ecosystemSync = new EcosystemSync(db);
db.onReadinessCalculated((snapshot) => ecosystemSync.publishReadiness(snapshot));

type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  user?: User;
  token?: string;
  body: unknown;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const readBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const send = (res: ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(payload));
};

const requireUser = (ctx: RequestContext): User => {
  if (!ctx.user) throw new HttpError(401, 'Authentication required.');
  return ctx.user;
};

const requireBody = <T>(ctx: RequestContext): T => ctx.body as T;

const route = (method: string, pattern: RegExp, handler: Handler) => ({ method, pattern, handler });

const routes = [
  route('POST', /^\/auth\/login$/, (ctx) => {
    const body = requireBody<LoginRequest>(ctx);
    const session = db.login(body.email, body.password);
    if (!session) throw new HttpError(401, 'Invalid email or password.');
    return session;
  }),

  route('POST', /^\/auth\/logout$/, (ctx) => {
    if (ctx.token) db.logout(ctx.token);
    return { success: true };
  }),

  route('GET', /^\/auth\/me$/, (ctx) => {
    const user = requireUser(ctx);
    return {
      user,
      athlete: user.role === 'athlete' ? db.getAthleteByUserId(user.id) : undefined,
    };
  }),

  route('POST', /^\/auth\/register$/, (ctx) => {
    const body = requireBody<RegisterRequest>(ctx);
    if (!body.email || !body.password || !body.name || !body.role) {
      throw new HttpError(400, 'email, password, name, and role are required.');
    }
    const user = db.createUser(body.email, body.password, body.name, body.role);
    if (user.role === 'athlete') {
      db.createAthlete({
        userId: user.id,
        name: body.name,
        email: user.email,
        dateOfBirth: '1990-01-01',
        gender: 'unspecified',
        specialtyDiscipline: 'olympic',
      });
    }
    return { user };
  }),

  route('GET', /^\/athletes$/, (ctx) => db.listAthletes(requireUser(ctx))),

  route('GET', /^\/athletes\/([^/]+)$/, (ctx) => {
    const user = requireUser(ctx);
    const id = ctx.url.pathname.split('/')[2];
    if (!db.canAccessAthlete(user, id)) throw new HttpError(403, 'Forbidden.');
    const athlete = db.getAthlete(id);
    if (!athlete) throw new HttpError(404, 'Athlete not found.');
    return athlete;
  }),

  route('PUT', /^\/athletes\/([^/]+)$/, (ctx) => {
    const user = requireUser(ctx);
    const id = ctx.url.pathname.split('/')[2];
    if (!db.canAccessAthlete(user, id)) throw new HttpError(403, 'Forbidden.');
    return db.updateAthlete(id, ctx.body as Record<string, unknown>, user.id);
  }),

  route('GET', /^\/coaches\/assignments$/, (ctx) => db.listCoachAssignments(requireUser(ctx))),

  route('POST', /^\/coaches\/assignments$/, (ctx) => {
    const user = requireUser(ctx);
    if (user.role !== 'coach') throw new HttpError(403, 'Only coaches can create assignments.');
    const body = requireBody<{ athleteId: string }>(ctx);
    if (!body.athleteId) throw new HttpError(400, 'athleteId is required.');
    return db.createCoachAssignment(user.id, body.athleteId, user.id);
  }),

  route('GET', /^\/sessions$/, (ctx) => {
    const user = requireUser(ctx);
    const athleteId = ctx.url.searchParams.get('athleteId');
    if (!athleteId) throw new HttpError(400, 'athleteId query parameter is required.');
    return db.listSessions(user, athleteId);
  }),

  route('POST', /^\/sessions$/, (ctx) => {
    const session = db.createSession(requireUser(ctx), requireBody<TrainingSessionInput>(ctx));
    ecosystemSync.emitSenti('session_imported', 'operational');
    return session;
  }),

  route('PUT', /^\/sessions\/([^/]+)$/, (ctx) => {
    const id = ctx.url.pathname.split('/')[2];
    return db.updateSession(requireUser(ctx), id, ctx.body as Partial<TrainingSessionInput>);
  }),

  route('DELETE', /^\/sessions\/([^/]+)$/, (ctx) => {
    const id = ctx.url.pathname.split('/')[2];
    db.deleteSession(requireUser(ctx), id);
    return { success: true };
  }),

  route('POST', /^\/sessions\/recompute$/, (ctx) => {
    const body = requireBody<{ athleteId: string }>(ctx);
    if (!body.athleteId) throw new HttpError(400, 'athleteId is required.');
    return db.recomputeSessions(requireUser(ctx), body.athleteId);
  }),

  route('GET', /^\/readiness$/, (ctx) => {
    const user = requireUser(ctx);
    const athleteId = ctx.url.searchParams.get('athleteId');
    const date = ctx.url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
    if (!athleteId) throw new HttpError(400, 'athleteId query parameter is required.');
    return db.getReadiness(user, athleteId, date);
  }),

  route('POST', /^\/readiness\/calculate$/, (ctx) => {
    const body = requireBody<{ athleteId: string; date?: string }>(ctx);
    if (!body.athleteId) throw new HttpError(400, 'athleteId is required.');
    const snapshot = db.calculateAndStoreReadiness(requireUser(ctx), body.athleteId, body.date ?? new Date().toISOString().slice(0, 10));
    return snapshot;
  }),

  route('GET', /^\/calibration$/, (ctx) => {
    const user = requireUser(ctx);
    const athleteId = ctx.url.searchParams.get('athleteId');
    if (!athleteId) throw new HttpError(400, 'athleteId query parameter is required.');
    return db.listCalibrationTests(user, athleteId);
  }),

  route('POST', /^\/calibration$/, (ctx) => {
    const input = requireBody<Omit<CalibrationTest, 'id' | 'createdAt'>>(ctx);
    return db.createCalibrationTest(requireUser(ctx), input);
  }),

  route('GET', /^\/coefficients$/, (ctx) => {
    requireUser(ctx);
    return db.listCoefficients(ctx.url.searchParams.get('athleteId') ?? undefined);
  }),

  route('POST', /^\/coefficients$/, (ctx) => {
    const user = requireUser(ctx);
    const input = requireBody<CoefficientSet>(ctx);
    return db.insertCoefficient(input, user.id);
  }),

  route('GET', /^\/ecosystem\/status$/, async (ctx) => {
    requireUser(ctx);
    const status = await fetchHubStatus();
    const settings = loadConnectionSettings(db.dbDir);
    const reports = Array.isArray(status.connections) ? status.connections : [];
    return {
      ...status,
      connections: [
        ...reports.filter(
          (report) =>
            typeof report !== 'object' ||
            report === null ||
            !('app' in report) ||
            report.app !== 'triathletePro'
        ),
        {
          app: 'triathletePro',
          settings,
          reportedAt: settings.updatedAt,
        },
      ],
    };
  }),

  route('GET', /^\/ecosystem\/connections$/, (ctx) => {
    requireUser(ctx);
    return loadConnectionSettings(db.dbDir);
  }),

  route('PUT', /^\/ecosystem\/connections$/, async (ctx) => {
    requireUser(ctx);
    const settings = saveConnectionSettings(
      db.dbDir,
      parseConnectionSettings(ctx.body)
    );
    await reportToHub(settings);
    return settings;
  }),

  route('GET', /^\/health$/, () => ({ ok: true, dbPath })),
];

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || undefined;
    const user = db.userForToken(token);
    const body = method === 'GET' || method === 'DELETE' ? {} : await readBody(req);
    const match = routes.find((candidate) => candidate.method === method && candidate.pattern.test(url.pathname));
    if (!match) throw new HttpError(404, `No route for ${method} ${url.pathname}`);
    const payload = await match.handler({ req, res, url, user, token, body });
    send(res, 200, payload);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : 'Unknown server error.';
    send(res, status, { error: message });
  }
});

server.listen(port, () => {
  console.log(`Triathlete Energy API listening on http://localhost:${port}`);
  console.log('Starter accounts: coach@local.test / password123, athlete@local.test / password123');
  ecosystemSync.start();
});

process.on('SIGINT', () => {
  ecosystemSync.stop();
  db.close();
  server.close(() => process.exit(0));
});
