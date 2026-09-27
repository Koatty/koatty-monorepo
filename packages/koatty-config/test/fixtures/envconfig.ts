/**
 * Fixture: embedded env interpolation (COR-08 / C-6).
 */
export default {
    dsn: "redis://${KOATTY_TEST_HOST}:${KOATTY_TEST_PORT}",
    fallback: "${KOATTY_TEST_MISSING:-fallback}",
    loose: "${KOATTY_TEST_UNDEFINED_VAR}",
    whole: "${KOATTY_TEST_HOST}"
}
