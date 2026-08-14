import proctorioConfig from "@proctorio/eslint-config";

export default [
	...proctorioConfig,
	{
		// Extension source keeps upstream-adjacent kebab-case filenames so the
		// fork's divergence from ken107/read-aloud stays navigable (decision
		// D11 in docs/lectern/00-implementation-plan.md). Tests and tooling
		// follow the house PascalCase rule from the base config.
		files: ["src/js/**/*.js", "tools/**/*.js"],
		rules: {
			"unicorn/filename-case": ["error", { "case": "kebabCase" }]
		}
	}
];
