import { expect, type Page } from "@playwright/test";

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Invoke the actual attached React closure so disabling the DOM alone cannot
// satisfy a write/recovery guard regression.
export async function forceClick(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).evaluate((element) => {
    const key = Object.keys(element).find((value) =>
      value.startsWith("__reactProps$"),
    );
    const props = key
      ? (
          element as unknown as Record<
            string,
            { onClick?: (event: { preventDefault: () => void }) => void }
          >
        )[key]
      : null;
    if (!props?.onClick) throw new Error("Actual React handler missing");
    (element as HTMLButtonElement).disabled = false;
    props.onClick({ preventDefault() {} });
  });
}

export async function holdAcknowledgment(page: Page) {
  await page.evaluate(() => {
    const original = window.fetch;
    let release!: () => void;
    const barrier = new Promise<void>((done) => {
      release = done;
    });
    Object.assign(window, { formsRelease: release, formsBodyHeld: false });
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (String(input) === "/api/forms" && init?.method === "POST") {
        const json = response.json.bind(response);
        response.json = async () => {
          const data = await json();
          Object.assign(window, { formsBodyHeld: true });
          await barrier;
          return data;
        };
      }
      return response;
    };
  });
}

export async function waitAcknowledgment(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => !!(window as unknown as { formsBodyHeld: boolean }).formsBodyHeld,
      ),
    )
    .toBe(true);
}

export async function releaseAcknowledgment(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { formsRelease: () => void }).formsRelease(),
  );
}
