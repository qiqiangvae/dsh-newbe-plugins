/**
 * dsh-newbe-ide 的 Host 面 Typert 清单（由 typert-loader 自动扫描注册）。
 * 手写清单，结构与 @deepseek-ai/dsh-typert-generator 产物一致：
 * `./typert` 导出 TYPERT，invocations 的 codec 必须是 zod v4 实例。
 */
import { ideaDiscoveryRequestSchema, ideaDiscoverySchema, ideLoadSchema, ideStateSchema, logHistoryRequestSchema, logHistorySchema, runReadRequestSchema, runReadSchema, runSnapshotListSchema, runSnapshotSchema, runTargetSchema } from './schema.js';

const stateCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#IdeState',
  schema: ideStateSchema,
};

const loadCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#IdeLoad',
  schema: ideLoadSchema,
};

const targetCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#RunTarget',
  schema: runTargetSchema,
};

const snapshotCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#RunSnapshot',
  schema: runSnapshotSchema,
};

const readRequestCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#RunReadRequest',
  schema: runReadRequestSchema,
};

const readCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#RunRead',
  schema: runReadSchema,
};

const discoveryRequestCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#IdeaDiscoveryRequest',
  schema: ideaDiscoveryRequestSchema,
};

const discoveryCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#IdeaDiscovery',
  schema: ideaDiscoverySchema,
};

const historyRequestCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#LogHistoryRequest',
  schema: logHistoryRequestSchema,
};

const historyCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#LogHistory',
  schema: logHistorySchema,
};

const snapshotListCodec = {
  mode: 'strict' as const,
  typeSymbol: 'dsh-newbe-ide#RunSnapshotList',
  schema: runSnapshotListSchema,
};

export const TYPERT = {
  package: 'dsh-newbe-ide',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-newbe-ide#ideConfig/load',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'load',
      invocation: { kind: 'direct' },
      parameters: [],
      result: loadCodec,
    },
    {
      id: 'dsh-newbe-ide#ideConfig/start',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'start',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'target', wire: 'target', source: 'json', codec: targetCodec }],
      result: snapshotCodec,
    },
    {
      id: 'dsh-newbe-ide#ideConfig/stop',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'stop',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'target', wire: 'target', source: 'json', codec: targetCodec }],
      result: snapshotCodec,
    },
    {
      id: 'dsh-newbe-ide#ideConfig/read',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'read',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: readRequestCodec }],
      result: readCodec,
    },
    {
      id: 'dsh-newbe-ide#ideConfig/runs',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'runs',
      invocation: { kind: 'direct' },
      parameters: [],
      result: snapshotListCodec,
    },
    {
      id: 'dsh-newbe-ide#ideConfig/discover',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'discover',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: discoveryRequestCodec }],
      result: discoveryCodec,
    },
    {
      id: 'dsh-newbe-ide#ideConfig/history',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'history',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: historyRequestCodec }],
      result: historyCodec,
    },
    {
      id: 'dsh-newbe-ide#ideConfig/submit',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'submit',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'next', wire: 'next', source: 'json', codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#IdeStateInput', schema: ideStateSchema } },
      ],
      result: stateCodec,
    },
  ],
  model: {
    services: [
      {
        description: 'IDE 面板的启动配置存储服务：读取磁盘配置与可选项目，或整份写回（原子写、0600）。',
        summary: '启动配置存储服务。',
        tags: [],
        key: 'ideConfig',
        exportName: 'ideConfig',
        members: [
          { kind: 'method', name: 'load', signature: 'load(): IdeLoad' },
          { kind: 'method', name: 'submit', signature: 'submit(next: IdeState): Promise<IdeState>' },
          { kind: 'method', name: 'start', signature: 'start(target: RunTarget): RunSnapshot' },
          { kind: 'method', name: 'stop', signature: 'stop(target: RunTarget): RunSnapshot' },
          { kind: 'method', name: 'read', signature: 'read(request: RunReadRequest): RunRead' },
          { kind: 'method', name: 'runs', signature: 'runs(): RunSnapshot[]' },
          { kind: 'method', name: 'history', signature: 'history(request: LogHistoryRequest): LogHistory' },
          { kind: 'method', name: 'discover', signature: 'discover(request: { workspaceId: string }): IdeaDiscovery' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
};

export default TYPERT;
