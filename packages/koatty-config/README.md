# koatty_config
Configuration loader for Koatty


# Usage

## 运行环境配置

`koatty_config` 可以自动识别当前运行环境，并且根据运行环境自动加载相应配置（如果存在）:

```js
const env = process.env.KOATTY_ENV || process.env.NODE_ENV || "";
```

如果 `env = production`, koatty_config 会自动加载以 `_pro.ts` 或 `_production.ts` 后缀的配置文件。

例如:

```sh
// 自动加载 config_dev.ts 或 config_development.ts
NODE_ENV=dev ts-node "test/test.ts"
```

## 命令行参数

`koatty_config` 可以自动识别命令行参数，并且自动填充到相应的配置项:

```sh
// 自动填充config.cc.dd.ee的值
NODE_ENV=dev ts-node "test/test.ts" --config.cc.dd.ee=77
```

## 占位符变量替换

`koatty_config` 可以自动将配置文件中使用 `${}` 占位符标识的配置项替换为process.env内的同名项的值:

config.ts
```js
export default {
    ...
    ff: "${ff_value}"
    ...
}
```

```sh
// 自动填充ff的值
NODE_ENV=dev ff_value=999 ts-node "test/test.ts"
```

## 配置验证

`koatty_config` 支持通过 Validation Schema 对配置进行验证，确保配置的正确性。

### 基本用法

```ts
import { LoadConfigs, ValidationSchema } from 'koatty_config';

// 定义验证规则
const schema: ValidationSchema = {
  port: {
    type: 'number',
    required: true,
    min: 1,
    max: 65535
  },
  host: {
    type: 'string',
    required: true
  },
  environment: {
    type: 'string',
    enum: ['development', 'production', 'test']
  }
};

// 加载并验证配置
const config = LoadConfigs(['./config'], process.cwd(), undefined, ['*.test.ts'], schema);
```

### Validation Schema

Validation Schema 定义了配置项的验证规则：

```typescript
interface ValidationSchema {
  [key: string]: {
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required?: boolean;
    default?: any;
    validator?: (value: any) => boolean | string;
    min?: number;
    max?: number;
    enum?: any[];
  };
}
```

### 验证规则

| 规则 | 类型 | 说明 |
|------|------|------|
| `type` | string | 验证值的类型：'string', 'number', 'boolean', 'object', 'array' |
| `required` | boolean | 是否必需字段 |
| `default` | any | 默认值（当字段未定义时使用） |
| `validator` | function | 自定义验证函数，返回 `true` 表示通过，返回 `string` 表示错误信息 |
| `min` | number | 最小值（仅对 number 类型有效） |
| `max` | number | 最大值（仅对 number 类型有效） |
| `enum` | array | 枚举值，值必须在数组中 |

### 示例

#### 1. 类型验证

```ts
const schema = {
  port: {
    type: 'number',
    required: true
  },
  debug: {
    type: 'boolean'
  }
};
```

#### 2. 范围验证

```ts
const schema = {
  port: {
    type: 'number',
    min: 1024,
    max: 65535
  },
  timeout: {
    type: 'number',
    min: 0
  }
};
```

#### 3. 枚举验证

```ts
const schema = {
  environment: {
    type: 'string',
    enum: ['development', 'production', 'test']
  }
};
```

#### 4. 自定义验证

```ts
const schema = {
  email: {
    type: 'string',
    validator: (value: string) => {
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'Invalid email format';
    }
  }
};
```

#### 5. 默认值

```ts
const schema = {
  port: {
    type: 'number',
    default: 3000
  },
  host: {
    type: 'string',
    default: 'localhost'
  }
};

// 即使配置文件中没有这些字段，也会使用默认值
```

#### 6. 嵌套对象验证

```ts
const schema = {
  database: {
    type: 'object',
    required: true
  }
};

// 验证 database 是否存在且为对象类型
```

### 错误处理

当配置验证失败时，会抛出详细的错误信息：

```ts
try {
  const config = LoadConfigs(['./config'], process.cwd(), undefined, undefined, schema);
} catch (error) {
  console.error(error.message);
  // 输出:
  // Configuration validation failed:
  //   - port: Property 'port' is required
  //   - environment: Property 'environment' must be one of: development, production, test
}
```

### 导出的验证函数

你也可以单独使用验证函数：

```ts
import { validateConfig, ValidationSchema, ValidationResult, applyDefaults } from 'koatty_config';

// 验证配置
const result: ValidationResult = validateConfig(config, schema);

if (!result.valid) {
  console.error('Validation failed:');
  result.errors.forEach(error => {
    console.error(`  - ${error.path}: ${error.message}`);
  });
}

// 应用默认值
const configWithDefaults = applyDefaults(config, schema);
```
