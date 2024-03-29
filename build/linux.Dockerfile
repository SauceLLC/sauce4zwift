ARG arch
FROM --platform=linux/${arch} fedora:36
RUN dnf install -y make nodejs git python gcc g++ libsecret-devel findutils
RUN git config --global credential.helper store
COPY . sauce4zwift
WORKDIR sauce4zwift
