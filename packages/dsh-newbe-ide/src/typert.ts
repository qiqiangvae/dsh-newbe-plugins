/**
 * dsh-newbe-ide 的 Host 面 Typert 清单（由 typert-loader 自动扫描注册）。
 * 手写清单，结构与 @deepseek-ai/dsh-typert-generator 产物一致：
 * `./typert` 导出 TYPERT，invocations 的 codec 统一由 `strictCodec()` 造（`create()` 惰性给出 zod v4 schema）。
 */
import { ideaDiscoveryRequestSchema, ideaDiscoverySchema, ideLoadSchema, ideStateSchema, logHistoryRequestSchema, logHistorySchema, runReadRequestSchema, runReadSchema, runSnapshotListSchema, runSnapshotSchema, runTargetSchema, secretQuerySchema, secretSetSchema, secretStatusListSchema, secretStatusSchema, strictCodec } from './schema.js';

const stateCodec = strictCodec('dsh-newbe-ide#IdeState', ideStateSchema);

const loadCodec = strictCodec('dsh-newbe-ide#IdeLoad', ideLoadSchema);

const targetCodec = strictCodec('dsh-newbe-ide#RunTarget', runTargetSchema);

const snapshotCodec = strictCodec('dsh-newbe-ide#RunSnapshot', runSnapshotSchema);

const readRequestCodec = strictCodec('dsh-newbe-ide#RunReadRequest', runReadRequestSchema);

const readCodec = strictCodec('dsh-newbe-ide#RunRead', runReadSchema);

const discoveryRequestCodec = strictCodec('dsh-newbe-ide#IdeaDiscoveryRequest', ideaDiscoveryRequestSchema);

const discoveryCodec = strictCodec('dsh-newbe-ide#IdeaDiscovery', ideaDiscoverySchema);

const historyRequestCodec = strictCodec('dsh-newbe-ide#LogHistoryRequest', logHistoryRequestSchema);

const historyCodec = strictCodec('dsh-newbe-ide#LogHistory', logHistorySchema);

const snapshotListCodec = strictCodec('dsh-newbe-ide#RunSnapshotList', runSnapshotListSchema);

const secretQueryCodec = strictCodec('dsh-newbe-ide#SecretQuery', secretQuerySchema);

const secretStatusListCodec = strictCodec('dsh-newbe-ide#SecretStatusList', secretStatusListSchema);

const secretSetCodec = strictCodec('dsh-newbe-ide#SecretSet', secretSetSchema);

const secretStatusCodec = strictCodec('dsh-newbe-ide#SecretStatus', secretStatusSchema);

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
        { name: 'next', wire: 'next', source: 'json', codec: strictCodec('dsh-newbe-ide#IdeStateInput', ideStateSchema) },
      ],
      result: stateCodec,
    },
    {
      id: 'dsh-newbe-ide#ideConfig/secretInfo',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'secretInfo',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: secretQueryCodec }],
      result: secretStatusListCodec,
    },
    {
      id: 'dsh-newbe-ide#ideConfig/secretSet',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'secretSet',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: secretSetCodec }],
      result: secretStatusCodec,
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
          { kind: 'method', name: 'start', signature: 'start(target: RunTarget): Promise<RunSnapshot>' },
          { kind: 'method', name: 'stop', signature: 'stop(target: RunTarget): RunSnapshot' },
          { kind: 'method', name: 'read', signature: 'read(request: RunReadRequest): RunRead' },
          { kind: 'method', name: 'runs', signature: 'runs(): RunSnapshot[]' },
          { kind: 'method', name: 'history', signature: 'history(request: LogHistoryRequest): LogHistory' },
          { kind: 'method', name: 'discover', signature: 'discover(request: { workspaceId: string }): IdeaDiscovery' },
          { kind: 'method', name: 'secretInfo', signature: 'secretInfo(request: { names: string[] }): Promise<SecretStatus[]>' },
          { kind: 'method', name: 'secretSet', signature: 'secretSet(request: { name: string; value: string }): Promise<SecretStatus>' },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
};

export default TYPERT;
