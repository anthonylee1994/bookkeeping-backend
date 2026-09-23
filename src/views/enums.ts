/** Bit-for-bit ports of the loco.rs enum name/parse helpers. */

export function accountKindName(kind: number): string {
    switch (kind) {
        case 0:
            return "cash";
        case 1:
            return "bank";
        case 2:
            return "credit_card";
        case 3:
            return "e_wallet";
        default:
            return "other";
    }
}

export function parseAccountKind(value: string): number | null {
    switch (value) {
        case "cash":
            return 0;
        case "bank":
            return 1;
        case "credit_card":
            return 2;
        case "e_wallet":
            return 3;
        case "other":
            return 4;
        default:
            return null;
    }
}

export function categoryKindName(kind: number): string {
    return kind === 0 ? "income" : "expense";
}

export function parseCategoryKind(value: string): number | null {
    switch (value) {
        case "income":
            return 0;
        case "expense":
            return 1;
        default:
            return null;
    }
}

export function transactionKindName(kind: number): string {
    switch (kind) {
        case 0:
            return "income";
        case 1:
            return "expense";
        default:
            return "transfer";
    }
}

export function parseTransactionKind(value: string): number | null {
    switch (value) {
        case "income":
            return 0;
        case "expense":
            return 1;
        case "transfer":
            return 2;
        default:
            return null;
    }
}

export function transactionSourceName(source: number): string {
    switch (source) {
        case 1:
            return "recurring";
        case 2:
            return "ai";
        case 3:
            return "import";
        default:
            return "manual";
    }
}

export function parseTransactionSource(value: string): number | null {
    switch (value) {
        case "manual":
            return 0;
        case "recurring":
            return 1;
        case "ai":
            return 2;
        case "import":
            return 3;
        default:
            return null;
    }
}

export function frequencyName(frequency: number): string {
    switch (frequency) {
        case 0:
            return "daily";
        case 1:
            return "weekly";
        case 2:
            return "monthly";
        default:
            return "yearly";
    }
}

export function parseFrequency(value: string): number | null {
    switch (value) {
        case "daily":
            return 0;
        case "weekly":
            return 1;
        case "monthly":
            return 2;
        case "yearly":
            return 3;
        default:
            return null;
    }
}

export function statusName(status: number): string {
    switch (status) {
        case 1:
            return "paused";
        case 2:
            return "ended";
        default:
            return "active";
    }
}

export function parseStatus(value: string): number | null {
    switch (value) {
        case "active":
            return 0;
        case "paused":
            return 1;
        case "ended":
            return 2;
        default:
            return null;
    }
}

export function aiStatusName(status: number): string {
    switch (status) {
        case 1:
            return "success";
        case 2:
            return "failed";
        case 3:
            return "partial";
        default:
            return "pending";
    }
}
