/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2021-12-01 17:22:13
 * @LastEditTime: 2024-11-06 15:24:18
 */
import { IOCContainer } from "koatty_container";
import { Koatty } from "koatty_core";
import { LoadConfigs } from "../src/index";
import { ConfigTest } from "./test";

describe("TestConfig", () => {
    beforeAll(async () => {
        process.env.NODE_ENV = "development";
        process.env.ff = "999";
    })
    test("LoadDir", async function () {
        const res = await LoadConfigs(["./test"], "", undefined, ["*.test.ts", "test.ts"])
        expect(res.config).not.toBeNull();
        expect(res.config.ff).toEqual("999");
        expect(res.config.aa).toEqual(4);
        console.log(res);
    });

    it("Config", async () => {
        const appConfig = await LoadConfigs(["./test"], "", undefined, ["*.test.ts", "test.ts"])
        const app = new Koatty();
        app.setMetaData("_configs", appConfig);
        IOCContainer.setApp(app);
        IOCContainer.reg("ConfigTest", ConfigTest);
        const ins = IOCContainer.get("ConfigTest");
        expect(ins.getBB()).toEqual(5);
    })

    it("Config Validation - Valid Config", async () => {
        const appConfig = await LoadConfigs(["./test"], "", undefined, ["*.test.ts", "test.ts"]);
        const schema = {
            config: {
                type: 'object',
                required: true
            },
            router: {
                type: 'object',
                required: true
            }
        };
        const result = await LoadConfigs(["./test"], "", undefined, ["*.test.ts", "test.ts"], schema);
        expect(result.config).toBeDefined();
        expect(result.config.ff).toBe("999");
        expect(result.config.aa).toBe(4);
    });

    it("Config Validation - Invalid Config Missing Required", async () => {
        const schema = {
            missingKey: {
                type: 'string',
                required: true
            }
        };
        expect(() => {
            LoadConfigs(["./test"], "", undefined, ["*.test.ts", "test.ts"], schema);
        }).toThrow("Configuration validation failed");
    });

    it("Config Validation - Invalid Config Type Mismatch", async () => {
        const schema = {
            config: {
                type: 'string'
            }
        };
        expect(() => {
            LoadConfigs(["./test"], "", undefined, ["*.test.ts", "test.ts"], schema);
        }).toThrow("Configuration validation failed");
    });

    it("Config Validation - Apply Defaults", async () => {
        const schema = {
            nonExistent: {
                type: 'string',
                default: 'default_value'
            }
        };
        const result = await LoadConfigs(["./test"], "", undefined, ["*.test.ts", "test.ts"], schema);
        expect(result.nonExistent).toBe("default_value");
    });

    it("Config Validation - Custom Validator", async () => {
        const schema = {
            config: {
                type: 'object',
                validator: (value: any) => {
                    return value && typeof value === 'object' || 'Must be an object';
                }
            }
        };
        const result = await LoadConfigs(["./test"], "", undefined, ["*.test.ts", "test.ts"], schema);
        expect(result.config.ff).toBe("999");
    });
});

