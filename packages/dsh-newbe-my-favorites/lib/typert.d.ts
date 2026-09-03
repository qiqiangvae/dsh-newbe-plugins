export declare const TYPERT: {
    package: string;
    face: string;
    schemas: never[];
    invocations: {
        id: string;
        service: string;
        namespace: string;
        method: string;
        invocation: {
            kind: string;
        };
        parameters: ({
            name: string;
            wire: string;
            source: string;
            codec: {
                mode: "strict";
                typeSymbol: string;
                schema: import("zod").ZodUnion<readonly [import("zod").ZodLiteral<"sessions">, import("zod").ZodLiteral<"urls">, import("zod").ZodLiteral<"mode">, import("zod").ZodLiteral<"recentCount">, import("zod").ZodLiteral<"urlsEnabled">]>;
            };
        } | {
            name: string;
            wire: string;
            source: string;
            codec: {
                mode: "strict";
                typeSymbol: string;
                schema: import("zod").ZodUnknown;
            };
        })[];
        result: {
            mode: "strict";
            typeSymbol: string;
            schema: import("zod").ZodObject<{
                sessions: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodString;
                    title: import("zod").ZodString;
                }, import("zod/v4/core").$strip>>;
                urls: import("zod").ZodArray<import("zod").ZodObject<{
                    id: import("zod").ZodString;
                    name: import("zod").ZodString;
                    url: import("zod").ZodString;
                    icon: import("zod").ZodString;
                    useFavicon: import("zod").ZodBoolean;
                }, import("zod/v4/core").$strip>>;
                mode: import("zod").ZodUnion<readonly [import("zod").ZodLiteral<"favorites">, import("zod").ZodLiteral<"recent">]>;
                recentCount: import("zod").ZodNumber;
                urlsEnabled: import("zod").ZodBoolean;
            }, import("zod/v4/core").$strip>;
        };
    }[];
    model: {
        services: {
            description: string;
            summary: string;
            tags: never[];
            key: string;
            exportName: string;
            members: {
                kind: string;
                name: string;
                signature: string;
            }[];
            types: never[];
        }[];
        events: never[];
        objects: never[];
    };
};
export default TYPERT;
