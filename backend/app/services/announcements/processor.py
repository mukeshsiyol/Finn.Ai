import re
from datetime import datetime


RULES = [
    ("results", 92, ("financial results", "quarterly results", "audited results", "unaudited results", "results for the quarter", "results for the year")),
    ("m&a", 90, ("acquisition", "acquire", "merger", "demerger", "joint venture", "stake sale", "stake acquisition", "amalgamation")),
    ("litigation", 88, ("sebi order", "regulatory order", "penalty", "fine", "insolvency", "winding up", "court order", "litigation")),
    ("management_change", 86, ("resignation of", "appointment of managing director", "appointment of chief executive", "appointment of chief financial", "change in director", "change in auditor", "ceo", "cfo")),
    ("fund_raise", 82, ("qip", "qualified institutional placement", "rights issue", "preferential issue", "preferential allotment", "commercial paper", "fund raising", "buyback")),
    ("pledging", 80, ("pledge", "encumbrance")),
    ("insider_trading", 78, ("promoter acquisition", "promoter sale", "disclosure under regulation 29", "insider trading")),
    ("credit_rating", 72, ("credit rating", "rating reaffirmed", "rating upgraded", "rating downgraded")),
    ("dividend", 72, ("dividend", "record date")),
    ("bonus_split", 70, ("bonus issue", "stock split", "sub-division of shares", "sub division of shares")),
    ("capex", 68, ("capital expenditure", "capex", "new manufacturing facility", "capacity expansion", "new plant")),
    ("earnings_call", 60, ("earnings call", "concall", "conference call", "transcript", "recording link")),
    ("investor_meetings", 48, ("investor meet", "analyst meet", "institutional investor", "investor conference")),
    ("postal_ballot", 45, ("postal ballot", "e-voting")),
    ("agm_egm", 42, ("annual general meeting", "extraordinary general meeting", "agm", "egm")),
    ("press_release", 38, ("press release", "order win", "new product", "partnership")),
]


def classify_announcement(subject: str, details: str = "") -> dict:
    text = re.sub(r"\s+", " ", f"{subject} {details}").strip().lower()
    for category, base_score, signals in RULES:
        matched = next((signal for signal in signals if signal in text), None)
        if matched:
            score = min(100, base_score + (5 if "outcome" in text or "approved" in text else 0))
            return {"category": category, "importance": score, "priority": _priority(score), "matched_signal": matched}
    return {"category": "unclassified", "importance": 15, "priority": "routine", "matched_signal": None}


def _priority(score: int) -> str:
    if score >= 80:
        return "high"
    if score >= 55:
        return "medium"
    return "routine"


def explain_with_rules(company: str, category: str, subject: str, details: str) -> str:
    explanations = {
        "results": "Results can change the view of growth, margins, and cash generation. Compare the filed numbers with prior periods and management guidance.",
        "m&a": "A transaction can change the company's assets, strategy, funding needs, or ownership. The filing should be reviewed for terms, approvals, and expected timing.",
        "fund_raise": "A capital raise or buyback can affect liquidity and share count. Check the amount, pricing, use of proceeds, and dilution terms.",
        "management_change": "A senior leadership change can affect execution and continuity. Review the effective date, stated reason, and successor's relevant experience.",
        "litigation": "A legal or regulatory matter can create financial, operating, or compliance exposure. The filing may not yet establish the likely outcome.",
        "pledging": "Changes in promoter pledging can alter collateral and ownership risk. Check the pledged percentage and the stated reason.",
        "insider_trading": "Promoter or insider trades can change ownership exposure. Check the buyer or seller, quantity, and post-transaction holding.",
        "credit_rating": "A rating action can affect borrowing cost and access to credit. Review the agency rationale and any outlook or watch status.",
        "dividend": "A dividend changes cash returned to shareholders. Check the amount, record date, and whether the payout is recurring.",
        "bonus_split": "A bonus or split changes the number of shares held but does not by itself change the company's value. Check the ratio and record date.",
        "capex": "A capacity or facility update may affect future investment and execution. The filing should establish timing, cost, and expected capacity.",
        "earnings_call": "The call or transcript can add management context to reported results. Treat forward-looking statements as guidance, not realised outcomes.",
        "investor_meetings": "Investor meetings can provide context, but the filing alone may contain little new operating information.",
        "postal_ballot": "A shareholder vote may change governance or corporate actions. Check the resolution and voting dates.",
        "agm_egm": "The meeting notice and resolutions can reveal decisions requiring shareholder approval. Check the agenda and voting details.",
        "press_release": "This item may describe an operational development. The announcement alone may not establish its financial impact.",
        "unclassified": "This filing has not matched a higher-priority category. Review its source before treating it as material.",
    }
    return explanations.get(category, explanations["unclassified"])
