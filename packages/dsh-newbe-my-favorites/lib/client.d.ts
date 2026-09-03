export declare const NS = "my-favorites";
export type SessionFavorite = {
    id: string;
    title: string;
};
export type UrlFavorite = {
    id: string;
    name: string;
    url: string;
    icon: string;
    useFavicon: boolean;
};
export type SwitcherMode = 'favorites' | 'recent';
export declare const inject: string[];
export declare function apply(ctx: any): Promise<void>;
