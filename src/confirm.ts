import { randomBytes, createHash } from "node:crypto";

interface Pending {
  token: string;
  fingerprint: string;
  expires: number;
  human?: {tool:string;args:Record<string,unknown>; approved:boolean};
}

/**
 * Guarda ações pendentes de confirmação. Quando approval=confirm, um tool com
 * efeito colateral primeiro devolve um token; a IA reenvia com o token para executar.
 * O fingerprint garante que o token só vale para EXATAMENTE aquela ação.
 */
export class ConfirmStore {
  private static humanStores = new Set<ConfirmStore>();
  private pending = new Map<string, Pending>();
  constructor(private capacity = 64, private ttlMs = 300000) {}
  sweep(): void { for (const [id, p] of this.pending) if (p.expires <= Date.now()) this.pending.delete(id); if (!this.pending.size) ConfirmStore.humanStores.delete(this); }
  get size(): number { this.sweep(); return this.pending.size; }

  private fingerprint(tool: string, args: Record<string, unknown>): string {
    return createHash("sha256").update(`${tool}:${JSON.stringify(args)}`).digest("hex");
  }

  issue(tool: string, args: Record<string, unknown>): string {
    this.sweep();
    if (this.pending.size >= this.capacity) throw new Error("Limite de confirmações pendentes atingido.");
    const token = randomBytes(32).toString("hex");
    this.pending.set(token, {
      token,
      fingerprint: this.fingerprint(tool, args),
      expires: Date.now() + this.ttlMs,
    });
    return token;
  }

  issueHuman(tool:string,args:Record<string,unknown>):string {
    if(JSON.stringify(args).length>20000)throw new Error("Ação excede preview local de 20.000 caracteres; divida a operação.");
    const existing=[...this.pending.values()].find(p=>p.human && p.fingerprint===this.fingerprint(tool,args) && p.expires>Date.now());
    if(existing)return existing.token;
    const id=this.issue(tool,args);
    this.pending.get(id)!.human={tool,args:structuredClone(args),approved:false};
    ConfirmStore.humanStores.add(this);
    return id;
  }
  static listHuman() {
    const result=[];
    for(const store of this.humanStores) {store.sweep(); for(const p of store.pending.values()) if(p.human) result.push({id:p.token,tool:p.human.tool,args:p.human.args,expires:p.expires,approved:p.human.approved});}
    return result;
  }
  static decideHuman(id:string,approve:boolean):boolean {
    for(const store of this.humanStores) {store.sweep();const p=store.pending.get(id);if(p?.human){if(approve)p.human.approved=true;else store.pending.delete(id);return true;}}
    return false;
  }
  consumeHuman(id:string,tool:string,args:Record<string,unknown>):boolean {
    this.sweep();const p=this.pending.get(id);
    if(!p?.human?.approved)return false;
    return this.consume(id,tool,args);
  }

  /** Limpa todas as confirmações pendentes (cleanup de sessão). */
  clear(): void {
    this.pending.clear();
    ConfirmStore.humanStores.delete(this);
  }

  /** Consome o token se válido e casar com a ação. Uso único. */
  consume(token: string, tool: string, args: Record<string, unknown>): boolean {
    const p = this.pending.get(token);
    if (!p) return false;
    this.pending.delete(token);
    if (Date.now() >= p.expires) return false;
    return p.fingerprint === this.fingerprint(tool, args);
  }
}
