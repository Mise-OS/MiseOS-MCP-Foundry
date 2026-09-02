// Promotion is binary at the Cedar layer. Registry-only values such as
// deny_promotion, unsupported, and historical_only stay outside Cedar.

forbid (
    principal,
    action == Action::"promote",
    resource
)
unless {
    resource.evaluation_status == "pass"
    && resource.requirements_satisfied
};

permit (
    principal,
    action == Action::"promote",
    resource
)
when {
    resource.evaluation_status == "pass"
    && resource.requirements_satisfied
};
