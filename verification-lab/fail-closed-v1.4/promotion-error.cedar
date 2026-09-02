@id("erroring_forbid")
forbid (
    principal,
    action == Action::"promote",
    resource
)
when {
    resource.diagnostic_guard == true
};

@id("pass_permit")
permit (
    principal,
    action == Action::"promote",
    resource
)
when {
    resource.evaluation_status == "pass"
    && resource.requirements_satisfied
};
