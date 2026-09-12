/**
 * dsh-newbe-ide 的 Host 面 Typert 清单（由 typert-loader 自动扫描注册）。
 * 手写清单，结构与 @deepseek-ai/dsh-typert-generator 产物一致：
 * `./typert` 导出 TYPERT，invocations 的 codec 必须是 zod v4 实例。
 */
import { ideLoadSchema, ideStateSchema, runReadRequestSchema, runReadSchema, runSnapshotListSchema, runSnapshotSchema, runTargetSchema } from './schema.js';

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
      parameters: [{ name: 'target', wire: 'target', source: 'json', codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunTarget', schema: runTargetSchema } }],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunSnapshot', schema: runSnapshotSchema },
    },
    {
      id: 'dsh-newbe-ide#ideConfig/stop',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'stop',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'target', wire: 'target', source: 'json', codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunTarget', schema: runTargetSchema } }],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunSnapshot', schema: runSnapshotSchema },
    },
    {
      id: 'dsh-newbe-ide#ideConfig/read',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'read',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunReadRequest', schema: runReadRequestSchema } }],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunRead', schema: runReadSchema },
    },
    {
      id: 'dsh-newbe-ide#ideConfig/runs',
      service: 'ideConfig',
      namespace: 'ideConfig',
      method: 'runs',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict' as const, typeSymbol: 'dsh-newbe-ide#RunSnapshotList', schema: runSnapshotListSchema },
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
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
};

export default TYPERT;
