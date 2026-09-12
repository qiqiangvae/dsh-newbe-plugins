/**
 * dsh-newbe-ide 的 Host 面 Typert 清单（由 typert-loader 自动扫描注册）。
 * 手写清单，结构与 @deepseek-ai/dsh-typert-generator 产物一致：
 * `./typert` 导出 TYPERT，invocations 的 codec 必须是 zod v4 实例。
 */
import { ideLoadSchema, ideStateSchema } from './schema.js';

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
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
};

export default TYPERT;
