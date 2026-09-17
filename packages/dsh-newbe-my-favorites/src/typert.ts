/**
 * dsh-newbe-my-favorites 的 Host 面 Typert 清单（由 typert-loader 自动扫描注册）。
 * 手写清单，结构与 @deepseek-ai/dsh-typert-generator 产物一致：
 * `./typert` 导出 TYPERT，invocations 的 codec 统一由 `strictCodec()` 造（同时带 `schema` 与 `create()`，跨 DSH 版本）。
 */
import {
  favoritesFieldSchema,
  favoritesFieldValueSchema,
  favoritesStateSchema,
  strictCodec,
} from './schema.js';

const stateCodec = strictCodec('dsh-newbe-my-favorites#FavoritesState', favoritesStateSchema);

const fieldCodec = strictCodec('dsh-newbe-my-favorites#FavoritesField', favoritesFieldSchema);

const valueCodec = strictCodec('dsh-newbe-my-favorites#FavoritesFieldValue', favoritesFieldValueSchema);

export const TYPERT = {
  package: 'dsh-newbe-my-favorites',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-newbe-my-favorites#myFavorites/getState',
      service: 'myFavorites',
      namespace: 'myFavorites',
      method: 'getState',
      invocation: { kind: 'direct' },
      parameters: [],
      result: stateCodec,
    },
    {
      id: 'dsh-newbe-my-favorites#myFavorites/setField',
      service: 'myFavorites',
      namespace: 'myFavorites',
      method: 'setField',
      invocation: { kind: 'direct' },
      parameters: [
        { name: 'field', wire: 'field', source: 'json', codec: fieldCodec },
        { name: 'value', wire: 'value', source: 'json', codec: valueCodec },
      ],
      result: stateCodec,
    },
  ],
  model: {
    services: [
      {
        description: '收藏状态的宿主存储服务：读取完整状态或按字段写入，落盘到 $DSH_HOME/storages/dsh-newbe-my-favorites.json。',
        summary: '收藏状态存储服务。',
        tags: [],
        key: 'myFavorites',
        exportName: 'myFavorites',
        members: [
          {
            kind: 'method',
            name: 'getState',
            signature: 'getState(): FavoritesState',
          },
          {
            kind: 'method',
            name: 'setField',
            signature: 'setField(field: FavoritesField, value: unknown): Promise<FavoritesState>',
          },
        ],
        types: [],
      },
    ],
    events: [],
    objects: [],
  },
};

export default TYPERT;
