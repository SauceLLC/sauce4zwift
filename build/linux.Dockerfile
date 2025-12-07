ARG arch
FROM --platform=linux/${arch} fedora:36
RUN dnf install -y make git python gcc g++ libsecret-devel findutils nspr nss dbus-libs atk at-spi2-atk gtk3
RUN curl -fsSL https://rpm.nodesource.com/setup_24.x | bash -
RUN dnf install -y nodejs
RUN git config --global credential.helper store
COPY . /sauce4zwift
WORKDIR /sauce4zwift
