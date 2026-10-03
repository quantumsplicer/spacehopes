export type MediaT = {
  id: number; kind: "image" | "drawing"; w: number; h: number; blurhash: string | null; alt: string; caption: string; v: number; key: string;
  variants: { webp: number[]; avif: number[]; png: boolean; svg: boolean };
};
export type Topic = { slug: string; name: string };
export type Card = {
  id: number; type: "thought" | "blog"; slug: string | null; title: string | null; excerpt: string; text: string | null;
  published_at: string | null; read_minutes: number; likes: number; comment_count: number; topics: Topic[]; thumb: MediaT | null;
};
export type Node = { type: string; attrs?: Record<string, any>; content?: Node[]; text?: string; marks?: { type: string; attrs?: Record<string, any> }[] };
export type Body = { type: "doc"; content: Node[] };
export type PostFull = Card & { standfirst: string | null; body: Body; media: Record<string, MediaT>; comments_open: boolean; cover: MediaT | null };
export type ThoughtFull = PostFull & { prev: { id: number; text: string } | null; next: { id: number; text: string } | null };
export type FeedPage = { items: Card[]; next_cursor: string | null; total: number | null };
export type PublicSettings = {
  site_name: string; about_quote: string; about_byline: string; about_quote_confirmed: boolean; footer_line: string; social_links: { label: string; url: string }[];
  comment_mode: "name" | "signed_in"; review_comments: boolean; disable_copy: boolean; turnstile_site_key: string; google_enabled?: boolean;
};
export type CommentT = { id: number; name: string; body: string; created_at: string; likes: number; is_author: boolean; replies: CommentT[] };
